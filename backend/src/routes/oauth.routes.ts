import { Router, Request, Response } from "express";
import { AuthRequest, authMiddleware } from "../middleware/auth.middleware";
import { OAuthService } from "../services/oauth.service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Get Instagram auth URL
router.get(
  "/instagram/auth-url",
  authMiddleware,
  (_req: AuthRequest, res: Response) => {
    const state = Math.random().toString(36).substring(7);
    res.json({ authUrl: OAuthService.getInstagramAuthUrl(state), state });
  }
);

// Instagram callback
router.post(
  "/instagram/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) {
        return res.status(400).json({ error: "Missing code" });
      }
      const account = await OAuthService.handleInstagramCallback(
        code,
        req.agencyId!
      );
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Get TikTok auth URL
router.get(
  "/tiktok/auth-url",
  authMiddleware,
  (_req: AuthRequest, res: Response) => {
    const state = Math.random().toString(36).substring(7);
    res.json({ authUrl: OAuthService.getTikTokAuthUrl(state), state });
  }
);

// TikTok callback
router.post(
  "/tiktok/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) {
        return res.status(400).json({ error: "Missing code" });
      }
      const account = await OAuthService.handleTikTokCallback(code, req.agencyId!);
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Get LinkedIn auth URL
router.get(
  "/linkedin/auth-url",
  authMiddleware,
  (_req: AuthRequest, res: Response) => {
    const state = Math.random().toString(36).substring(7);
    res.json({ authUrl: OAuthService.getLinkedInAuthUrl(state), state });
  }
);

// LinkedIn callback
router.post(
  "/linkedin/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { code } = req.body as { code?: string };
      if (!code) {
        return res.status(400).json({ error: "Missing code" });
      }
      const account = await OAuthService.handleLinkedInCallback(
        code,
        req.agencyId!
      );
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Get Twitter auth URL
router.get(
  "/twitter/auth-url",
  authMiddleware,
  (_req: AuthRequest, res: Response) => {
    const state = Math.random().toString(36).substring(7);
    res.json({
      authUrl: OAuthService.getTwitterAuthUrl(state),
      state,
      codeVerifier: state,
    });
  }
);

// Twitter callback
router.post(
  "/twitter/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { code, codeVerifier } = req.body as {
        code?: string;
        codeVerifier?: string;
      };
      if (!code || !codeVerifier) {
        return res.status(400).json({ error: "Missing code or verifier" });
      }
      const account = await OAuthService.handleTwitterCallback(
        code,
        req.agencyId!,
        codeVerifier
      );
      res.json(account);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Get all connected accounts
router.get(
  "/accounts",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const accounts = await prisma.socialAccount.findMany({
        where: { agencyId: req.agencyId },
      });
      res.json(accounts);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Disconnect account
router.delete(
  "/accounts/:accountId",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      await prisma.socialAccount.delete({
        where: { id: req.params.accountId },
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

export default router;
