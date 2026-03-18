import Queue from "bull";
import { PrismaClient, PostPlatformStatus, PostStatus } from "@prisma/client";
import { formatContent } from "../../utils/platform-helpers";
import { decryptToken } from "../../utils/encryption";
import { FacebookAdapter } from "./platform-adapters/facebook.adapter";
import { InstagramAdapter } from "./platform-adapters/instagram.adapter";
import { TwitterAdapter } from "./platform-adapters/twitter.adapter";
import { LinkedInAdapter } from "./platform-adapters/linkedin.adapter";
import { PinterestAdapter } from "./platform-adapters/pinterest.adapter";
import { WordPressAdapter } from "./platform-adapters/wordpress.adapter";

const prisma = new PrismaClient();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is required to run the post queue");
}

export const postQueue = new Queue("posts", redisUrl);

const adapters: Record<string, any> = {
  facebook: FacebookAdapter,
  instagram: InstagramAdapter,
  twitter: TwitterAdapter,
  linkedin: LinkedInAdapter,
  pinterest: PinterestAdapter,
  wordpress: WordPressAdapter,
};

export const addPostToQueue = async (
  postId: string,
  scheduledAt?: Date | null
) => {
  const delay =
    scheduledAt && scheduledAt.getTime() > Date.now()
      ? scheduledAt.getTime() - Date.now()
      : 0;

  await postQueue.add(
    { postId },
    {
      delay,
      jobId: scheduledAt ? `${postId}-${scheduledAt.getTime()}` : postId,
    }
  );
};

export const retryFailedPost = async (postId: string) => {
  await addPostToQueue(postId, null);
};

postQueue.process(async (job) => {
  const postId = job.data.postId as string;
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      platformIntegrations: {
        include: { userIntegration: { include: { integration: true } } },
      },
    },
  });

  if (!post) return;

  const results: boolean[] = [];

  for (const integration of post.platformIntegrations) {
    const platform = integration.userIntegration.integration.slug;
    const adapter = adapters[platform];

    if (!adapter) {
      await prisma.postIntegration.update({
        where: { id: integration.id },
        data: {
          status: PostPlatformStatus.FAILED,
          error: `No adapter for ${platform}`,
          retryCount: integration.retryCount + 1,
        },
      });
      results.push(false);
      continue;
    }

    const content = formatContent(integration.content, platform);
    let accessToken = integration.userIntegration.accessToken;

    if (accessToken) {
      try {
        accessToken = decryptToken(accessToken);
      } catch {
        // leave as-is if already plain text
      }
    }

    const userIntegration = {
      ...integration.userIntegration,
      accessToken,
    };

    const response = await adapter.publishPost(content, null, userIntegration);

    if (response?.success) {
      await prisma.postIntegration.update({
        where: { id: integration.id },
        data: {
          status: PostPlatformStatus.POSTED,
          platformPostId: response.platformPostId ?? null,
          postedAt: new Date(),
          error: null,
        },
      });
      results.push(true);
    } else {
      await prisma.postIntegration.update({
        where: { id: integration.id },
        data: {
          status: PostPlatformStatus.FAILED,
          error: response?.error ?? "Publish failed",
          retryCount: integration.retryCount + 1,
        },
      });
      results.push(false);
    }
  }

  if (!results.length) return;

  const allPosted = results.every(Boolean);
  const anyFailed = results.some((value) => !value);

  if (allPosted) {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.POSTED, postedAt: new Date() },
    });
  } else if (anyFailed) {
    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.FAILED },
    });
  }
});
