import { Router, Response } from "express";
import { PrismaClient, PostStatus } from "@prisma/client";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { PostService } from "../services/post.service";

const prisma = new PrismaClient();
const router = Router();

router.post("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, socialAccountIds, integrationIds, scheduledAt } =
      req.body as {
        title?: string;
        content?: unknown;
        socialAccountIds?: string[];
        integrationIds?: string[];
        scheduledAt?: string | null;
      };

    if (!title || !content) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (integrationIds?.length) {
      const post = await PostService.createPostWithIntegrations(
        req.agencyId!,
        req.userId!,
        title,
        content,
        integrationIds,
        scheduledAt ? new Date(scheduledAt) : null
      );
      return res.status(201).json(post);
    }

    if (!socialAccountIds?.length) {
      return res.status(400).json({ error: "Missing social accounts" });
    }

    const post = await PostService.createPost(
      req.agencyId!,
      req.userId!,
      title,
      content,
      socialAccountIds
    );

    res.status(201).json(post);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { status, createdById, search } = req.query as {
      status?: PostStatus;
      createdById?: string;
      search?: string;
    };

    const posts = await PostService.getPosts(req.agencyId!, {
      status,
      createdById,
      search,
    });

    res.json(posts);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.get(
  "/pending",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const posts = await PostService.getPendingPosts(req.agencyId!);
      res.json(posts);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/posted",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const posts = await PostService.getPostedPosts(req.agencyId!);
      res.json(posts);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.get(
  "/failed",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const posts = await PostService.getFailedPosts(req.agencyId!);
      res.json(posts);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.put("/:id", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, status, scheduledAt } = req.body as {
      title?: string;
      content?: unknown;
      status?: PostStatus;
      scheduledAt?: string | null;
    };

    const post = await PostService.updatePost(req.params.id, req.agencyId!, {
      title,
      content,
      status,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : scheduledAt,
    });

    res.json(post);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(
  "/:id/schedule",
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

router.delete(
  "/:id",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await prisma.post.deleteMany({
        where: { id: req.params.id, agencyId: req.agencyId },
      });

      if (!result.count) {
        return res.status(404).json({ error: "Post not found" });
      }

      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

router.post(
  "/:id/generate-variations",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await prisma.post.findFirst({
        where: { id: req.params.id, agencyId: req.agencyId },
      });

      if (!post) {
        return res.status(404).json({ error: "Post not found" });
      }

      const content = post.content as unknown;
      let original = "";

      if (typeof content === "string") {
        original = content;
      } else if (content && typeof content === "object" && "original" in content) {
        original = String((content as { original?: string }).original ?? "");
      } else {
        original = JSON.stringify(content ?? "");
      }

      const variations = await PostService.generateVariations(original);
      res.json({ variations });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
