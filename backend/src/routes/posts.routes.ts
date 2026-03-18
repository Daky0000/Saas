import { Router, Response } from "express";
import { PrismaClient, PostStatus, PostPlatformStatus } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { addPostToQueue, removePostJobs, retryFailedPost } from "../services/automation/queue";
import { pickPlatformContent } from "../utils/platform-helpers";
import { logIntegrationEvent } from "../utils/integration-log";

const router = Router();
const prisma = new PrismaClient();

const parseDate = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const buildPlatformStatuses = (post: any) => {
  return post.platformIntegrations.map((integration: any) => ({
    platform: integration.userIntegration.integration.slug,
    accountName: integration.userIntegration.accountName,
    status: integration.status,
    platformPostId: integration.platformPostId,
    postedAt: integration.postedAt,
    error: integration.error,
  }));
};

const getFirstIntegration = async (postId: string) => {
  return prisma.postIntegration.findFirst({
    where: { postId },
    include: { userIntegration: true },
  });
};

// POST /api/posts
router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, integrationIds, scheduledAt, media } = req.body as {
      title?: string;
      content?: unknown;
      integrationIds?: string[];
      scheduledAt?: string;
      media?: any;
    };

    if (!title || !content) {
      return res.status(400).json({ error: "Missing title or content" });
    }

    if (!integrationIds || !Array.isArray(integrationIds) || !integrationIds.length) {
      return res
        .status(400)
        .json({ error: "Select at least one integration" });
    }

    const scheduledDate = parseDate(scheduledAt);
    const now = new Date();
    const status =
      scheduledDate && scheduledDate.getTime() > now.getTime()
        ? PostStatus.SCHEDULED
        : PostStatus.APPROVED;

    const userIntegrations = await prisma.userIntegration.findMany({
      where: { id: { in: integrationIds }, userId: req.userId! },
      include: { integration: true },
    });

    if (userIntegrations.length !== integrationIds.length) {
      return res.status(400).json({ error: "Invalid integration selection" });
    }

    const post = await prisma.post.create({
      data: {
        title,
        content: content as any,
        status,
        scheduledAt: scheduledDate,
        agencyId: req.agencyId!,
        createdById: req.userId!,
        platformIntegrations: {
          create: userIntegrations.map((integration) => ({
            userIntegrationId: integration.id,
            content: pickPlatformContent(content, integration.integration.slug),
            media: media ?? undefined,
            status: PostPlatformStatus.PENDING,
          })),
        },
      },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    await logIntegrationEvent({
      userId: req.userId!,
      integrationId: userIntegrations[0].integrationId,
      userIntegrationId: userIntegrations[0].id,
      eventType: "post_created",
      status: "success",
      response: { postId: post.id },
    });

    res.status(201).json({
      ...post,
      platformStatuses: buildPlatformStatuses(post),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/posts
router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const posts = await prisma.post.findMany({
      where: {
        agencyId: req.agencyId!,
        ...(status ? { status: status as PostStatus } : {}),
      },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      posts.map((post) => ({
        ...post,
        platformStatuses: buildPlatformStatuses(post),
      }))
    );
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/posts/:id
router.get("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const post = await prisma.post.findFirst({
      where: { id: req.params.id, agencyId: req.agencyId! },
      include: {
        platformIntegrations: {
          include: { userIntegration: { include: { integration: true } } },
        },
      },
    });

    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json({
      ...post,
      platformStatuses: buildPlatformStatuses(post),
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// POST /api/posts/:id/post-now
router.post(
  "/:id/post-now",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.APPROVED, scheduledAt: null },
      });

      const jobId = await addPostToQueue(post.id, null);

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_now",
          status: "success",
          response: { jobId },
        });
      }

      res.json({ success: true, message: "Queued", jobId });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/schedule
router.post(
  "/:id/schedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt } = req.body as { scheduledAt?: string };
      const scheduledDate = parseDate(scheduledAt);
      if (!scheduledDate) {
        return res.status(400).json({ error: "Invalid schedule date" });
      }
      if (scheduledDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: "Schedule must be in the future" });
      }

      const existing = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!existing) {
        return res.status(404).json({ error: "Post not found" });
      }

      const post = await prisma.post.update({
        where: { id: existing.id },
        data: { scheduledAt: scheduledDate, status: PostStatus.SCHEDULED },
      });

      const jobId = await addPostToQueue(post.id, scheduledDate);

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_scheduled",
          status: "success",
          response: { jobId, scheduledAt: scheduledDate.toISOString() },
        });
      }

      res.json({ ...post, jobId });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/posts/:id/cancel
router.post(
  "/:id/cancel",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await removePostJobs(post.id, post.scheduledAt);

      const updated = await prisma.post.update({
        where: { id: post.id },
        data: { status: PostStatus.APPROVED, scheduledAt: null },
      });

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_cancelled",
          status: "success",
          response: { postId: post.id },
        });
      }

      res.json({ success: true, post: updated });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// DELETE /api/posts/:id
router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      await removePostJobs(post.id, post.scheduledAt);

      const firstIntegration = await getFirstIntegration(post.id);
      await prisma.post.delete({ where: { id: post.id } });

      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_deleted",
          status: "success",
          response: { postId: post.id },
        });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);
// POST /api/posts/:id/retry
router.post(
  "/:id/retry",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const jobId = await retryFailedPost(post.id);
      const integrations = await prisma.postIntegration.findMany({
        where: { postId: post.id },
      });

      const firstIntegration = await getFirstIntegration(post.id);
      if (firstIntegration) {
        await logIntegrationEvent({
          userId: req.userId!,
          integrationId: firstIntegration.userIntegration.integrationId,
          userIntegrationId: firstIntegration.userIntegrationId,
          eventType: "post_retry",
          status: "success",
          response: { jobId },
        });
      }

      res.json({ jobId, integrations });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/posts/:id/status
router.get(
  "/:id/status",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId! },
        include: {
          platformIntegrations: {
            include: { userIntegration: { include: { integration: true } } },
          },
        },
      });

      if (!post) return res.status(404).json({ error: "Post not found" });

      const platformStatuses = buildPlatformStatuses(post);
      const overallStatus = platformStatuses.every(
        (status: any) => status.status === PostPlatformStatus.POSTED
      )
        ? "POSTED"
        : platformStatuses.some(
            (status: any) => status.status === PostPlatformStatus.FAILED
          )
          ? "FAILED"
          : "PENDING";

      res.json({ post, platformStatuses, overallStatus });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;

