import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { addPostToQueue, retryFailedPost } from "../services/automation/queue";
import { PostService } from "../services/post.service";
import { PostStatus } from "@prisma/client";

const router = Router();

router.post(
  "/posts/:id/queue",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      await addPostToQueue(req.params.id, null);
      res.json({ queued: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/retry",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      await retryFailedPost(req.params.id);
      res.json({ retrying: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/posts/:id/schedule",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { scheduledAt } = req.body as { scheduledAt?: string };
      if (!scheduledAt) {
        return res.status(400).json({ error: "Missing scheduledAt" });
      }

      const post = await PostService.updatePost(req.params.id, req.agencyId!, {
        status: PostStatus.SCHEDULED,
        scheduledAt: new Date(scheduledAt),
      });

      await PostService.addPostToAutomationQueue(
        post.id,
        post.scheduledAt ?? undefined
      );

      res.json(post);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
