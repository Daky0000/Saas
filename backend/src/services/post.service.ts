import Anthropic from "@anthropic-ai/sdk";
import { Prisma, PrismaClient, PostStatus, PostPlatformStatus } from "@prisma/client";
import { addPostToQueue } from "./automation/queue";
import { formatContent } from "../utils/platform-helpers";

const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface PostFilters {
  status?: PostStatus;
  createdById?: string;
  search?: string;
}

export class PostService {
  private static normalizeContent(content: unknown): Prisma.InputJsonValue {
    if (typeof content === "string") {
      return { original: content } as Prisma.InputJsonValue;
    }
    if (content && typeof content === "object") {
      return content as Prisma.InputJsonValue;
    }
    return { original: "" } as Prisma.InputJsonValue;
  }

  private static extractOriginalContent(content: unknown): string {
    if (typeof content === "string") return content;
    if (content && typeof content === "object" && "original" in content) {
      return String((content as { original?: string }).original ?? "");
    }
    return "";
  }

  private static extractPlatformContent(
    content: unknown,
    platform: string
  ): string | null {
    if (content && typeof content === "object" && platform in content) {
      return String((content as Record<string, unknown>)[platform] ?? "");
    }
    return null;
  }

  static formatPostForPlatform(content: string, platform: string) {
    return formatContent(content, platform);
  }

  static async addPostToAutomationQueue(postId: string, scheduledAt?: Date | null) {
    try {
      await addPostToQueue(postId, scheduledAt ?? undefined);
    } catch (error) {
      console.error("Failed to enqueue post", error);
    }
  }

  static async createPost(
    agencyId: string,
    createdById: string,
    title: string,
    content: unknown,
    socialAccountIds: string[]
  ) {
    if (!socialAccountIds?.length) {
      throw new Error("At least one social account is required");
    }

    const accounts = await prisma.socialAccount.findMany({
      where: { id: { in: socialAccountIds }, agencyId },
      select: { id: true },
    });

    if (accounts.length !== socialAccountIds.length) {
      throw new Error("One or more social accounts not found for agency");
    }

    return prisma.post.create({
      data: {
        agencyId,
        title,
        content: this.normalizeContent(content),
        createdById,
        socialAccounts: {
          connect: accounts.map((account) => ({ id: account.id })),
        },
      },
      include: { socialAccounts: true },
    });
  }

  static async createPostWithIntegrations(
    agencyId: string,
    createdById: string,
    title: string,
    content: unknown,
    userIntegrationIds: string[],
    scheduledAt?: Date | null
  ) {
    if (!userIntegrationIds?.length) {
      throw new Error("Select at least one integration");
    }

    const integrations = await prisma.userIntegration.findMany({
      where: { id: { in: userIntegrationIds }, userId: createdById },
      include: { integration: true },
    });

    if (integrations.length !== userIntegrationIds.length) {
      throw new Error("One or more integrations are invalid");
    }

    const original = this.extractOriginalContent(content);

    const post = await prisma.post.create({
      data: {
        agencyId,
        title,
        content: this.normalizeContent(content),
        createdById,
        scheduledAt: scheduledAt ?? null,
        status: scheduledAt ? PostStatus.SCHEDULED : PostStatus.PENDING,
        platformIntegrations: {
          create: integrations.map((integration) => {
            const platform = integration.integration.slug;
            const platformContent =
              this.extractPlatformContent(content, platform) ?? original;
            return {
              userIntegrationId: integration.id,
              content: this.formatPostForPlatform(platformContent, platform),
              status: scheduledAt ? PostPlatformStatus.SCHEDULED : PostPlatformStatus.PENDING,
            };
          }),
        },
      },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    await this.addPostToAutomationQueue(post.id, scheduledAt ?? undefined);
    return post;
  }

  static async generateVariations(content: string) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("Missing ANTHROPIC_API_KEY");
    }

    const message = await anthropic.messages.create({
      model: "claude-opus-4-1",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Generate platform-specific versions of this post:\n\nOriginal: "${content}"\n\nReturn ONLY valid JSON (no markdown, no extra text) with this structure:\n{\n  "instagram": "...",\n  "tiktok": "...",\n  "linkedin": "...",\n  "twitter": "..."\n}`,
        },
      ],
    });

    const textBlock = message.content.find((block) => block.type === "text");
    const text = textBlock?.text?.trim() ?? "";

    if (!text) {
      throw new Error("Claude returned an empty response");
    }

    try {
      return JSON.parse(text) as {
        instagram: string;
        tiktok: string;
        linkedin: string;
        twitter: string;
      };
    } catch {
      throw new Error("Claude response was not valid JSON");
    }
  }

  static async updatePost(
    postId: string,
    agencyId: string,
    data: {
      title?: string;
      content?: unknown;
      status?: PostStatus;
      scheduledAt?: Date | null;
    }
  ) {
    const existing = await prisma.post.findFirst({
      where: { id: postId, agencyId },
    });

    if (!existing) {
      throw new Error("Post not found");
    }

    const updateData: Prisma.PostUpdateInput = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.content !== undefined)
      updateData.content = this.normalizeContent(data.content);
    if (data.status !== undefined) updateData.status = data.status;
    if (data.scheduledAt !== undefined)
      updateData.scheduledAt = data.scheduledAt;

    return prisma.post.update({
      where: { id: postId },
      data: updateData,
      include: { socialAccounts: true, platformIntegrations: true },
    });
  }

  static async getPosts(agencyId: string, filters?: PostFilters) {
    const where: Prisma.PostWhereInput = { agencyId };

    if (filters?.status) where.status = filters.status;
    if (filters?.createdById) where.createdById = filters.createdById;
    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: "insensitive" } },
      ];
    }

    return prisma.post.findMany({
      where,
      include: {
        socialAccounts: true,
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  static getPendingPosts(agencyId: string) {
    return this.getPosts(agencyId, { status: PostStatus.PENDING });
  }

  static getPostedPosts(agencyId: string) {
    return this.getPosts(agencyId, { status: PostStatus.POSTED });
  }

  static getFailedPosts(agencyId: string) {
    return this.getPosts(agencyId, { status: PostStatus.FAILED });
  }
}
