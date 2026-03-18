import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { IntegrationService } from "../services/integration.service";

const router = Router();

// GET /api/integrations - list all integrations
router.get("/", authMiddleware, async (_req: AuthRequest, res: Response) => {
  try {
    const integrations = await IntegrationService.getIntegrations();
    res.json(integrations);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// GET /api/integrations/:slug/auth-url
router.get(
  "/:slug/auth-url",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const state = Math.random().toString(36).substring(7);
      const authUrl = IntegrationService.getOAuthUrl(req.params.slug, state);
      if (!authUrl) {
        return res.status(404).json({ error: "Unsupported integration" });
      }
      res.json({ authUrl, state });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/integrations/:slug/callback
router.post(
  "/:slug/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const integration = await IntegrationService.getIntegration(req.params.slug);
      if (!integration) {
        return res.status(404).json({ error: "Integration not found" });
      }

      const { accountId, accountName, accountEmail, accessToken, refreshToken, tokenExpiry } =
        req.body as {
          accountId?: string;
          accountName?: string;
          accountEmail?: string;
          accessToken?: string;
          refreshToken?: string;
          tokenExpiry?: string;
        };

      if (!accountId || !accountName) {
        return res.status(400).json({ error: "Missing account details" });
      }

      const result = await IntegrationService.connectIntegration(
        req.userId!,
        integration.id,
        {
          accountId,
          accountName,
          accountEmail,
          accessToken,
          refreshToken,
          tokenExpiry: tokenExpiry ? new Date(tokenExpiry) : null,
        }
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/my-integrations
router.get(
  "/my/all",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const integrations = await IntegrationService.getUserIntegrations(req.userId!);
      res.json(integrations);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// DELETE /api/integrations/:id/disconnect
router.delete(
  "/:id/disconnect",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await IntegrationService.disconnectIntegration(
        req.userId!,
        req.params.id
      );
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// POST /api/integrations/:id/accounts
router.post(
  "/:id/accounts",
  authMiddleware,
  async (_req: AuthRequest, res: Response) => {
    res.json({ accounts: [] });
  }
);

// GET /api/integrations/:id/status
router.get(
  "/:id/status",
  authMiddleware,
  async (_req: AuthRequest, res: Response) => {
    res.json({ status: "unknown" });
  }
);

export default router;
