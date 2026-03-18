import cron from "node-cron";
import { PrismaClient, PostStatus } from "@prisma/client";
import { addPostToQueue } from "./queue";
import { logIntegrationEvent } from "../../utils/integration-log";
import { AnalyticsSyncService } from "../analytics-sync.service";

const prisma = new PrismaClient();

export const handleScheduledPosts = async () => {
  const now = new Date();

  const posts = await prisma.post.findMany({
    where: {
      status: { in: [PostStatus.APPROVED, PostStatus.SCHEDULED] },
      scheduledAt: { lte: now },
      postedAt: null,
    },
    include: { platformIntegrations: { include: { userIntegration: true } } },
  });

  for (const post of posts) {
    if (!post.platformIntegrations.length) continue;

    const jobId = await addPostToQueue(post.id, null);

    await prisma.post.update({
      where: { id: post.id },
      data: { status: PostStatus.SCHEDULED },
    });

    const firstIntegration = post.platformIntegrations[0];
    await logIntegrationEvent({
      userId: post.createdById,
      integrationId: firstIntegration.userIntegration.integrationId,
      userIntegrationId: firstIntegration.userIntegrationId,
      eventType: "scheduled",
      status: "success",
      response: { jobId },
    });
  }
};

export const startScheduler = () => {
  cron.schedule("* * * * *", async () => {
    try {
      await handleScheduledPosts();
    } catch (error) {
      console.error("Scheduler error:", error);
    }
  });

  cron.schedule("0 2 * * *", async () => {
    try {
      const agencies = await prisma.agency.findMany({ include: { users: true } });
      for (const agency of agencies) {
        for (const user of agency.users) {
          await AnalyticsSyncService.syncAllUserAnalytics(user.id, agency.id);
        }
      }
    } catch (error) {
      console.error("Analytics sync error:", error);
    }
  });
};
