import { Router, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { IntegrationService } from "../services/integration.service";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const FRONTEND_URL = process.env.FRONTEND_URL || "https://marketing.dakyworld.com";

type StatePayload = {
  type: "integration_state";
  userId: string;
  slug: string;
  codeVerifier?: string;
};

const generateCodeVerifier = () => {
  const random = crypto.randomBytes(32).toString("base64");
  return random.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const signState = (payload: StatePayload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });

const verifyState = (token: string) => {
  const payload = jwt.verify(token, JWT_SECRET) as StatePayload;
  if (payload.type !== "integration_state") {
    throw new Error("Invalid state token");
  }
  return payload;
};

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
      const { slug } = req.params;
      const codeVerifier = slug === "twitter" ? generateCodeVerifier() : undefined;
      const state = signState({
        type: "integration_state",
        userId: req.userId!,
        slug,
        codeVerifier,
      });

      const authUrl = IntegrationService.getOAuthUrl(slug, state, codeVerifier);
      if (!authUrl) {
        return res.status(404).json({ error: "Unsupported integration" });
      }
      res.json({ authUrl, state });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/integrations/:slug/callback (OAuth redirect)
router.get("/:slug/callback", async (req, res) => {
  const { slug } = req.params;
  const { code, state, error } = req.query as {
    code?: string;
    state?: string;
    error?: string;
  };

  if (error) {
    return res.redirect(`${FRONTEND_URL}/integrations?status=error`);
  }

  if (!code || !state) {
    return res.redirect(`${FRONTEND_URL}/integrations?status=missing_code`);
  }

  try {
    const payload = verifyState(state);

    if (payload.slug !== slug) {
      return res.redirect(`${FRONTEND_URL}/integrations?status=state_mismatch`);
    }

    await IntegrationService.handleOAuthCallback(
      slug,
      code,
      payload.userId,
      payload.codeVerifier
    );

    return res.redirect(`${FRONTEND_URL}/integrations?connected=${slug}`);
  } catch (error: any) {
    return res.redirect(
      `${FRONTEND_URL}/integrations?status=error&message=${encodeURIComponent(
        error.message || "OAuth failed"
      )}`
    );
  }
});

// POST /api/integrations/:slug/callback (SPA)
router.post(
  "/:slug/callback",
  authMiddleware,
  async (req: AuthRequest, res: Response) => {
    try {
      const { slug } = req.params;
      const { code, codeVerifier } = req.body as {
        code?: string;
        codeVerifier?: string;
      };

      if (!code) {
        return res.status(400).json({ error: "Missing code" });
      }

      const result = await IntegrationService.handleOAuthCallback(
        slug,
        code,
        req.userId!,
        codeVerifier
      );

      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
);

// GET /api/integrations/my/all
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
