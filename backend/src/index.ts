import cors from "cors";
import dotenv from "dotenv";
import express, { Express } from "express";
import authRoutes from "./routes/auth.routes";
import oauthRoutes from "./routes/oauth.routes";
import postsRoutes from "./routes/posts.routes";
import integrationsRoutes from "./routes/integrations.routes";
import automationRoutes from "./routes/automation.routes";
import { startScheduler } from "./services/automation/scheduler";
import { seedDefaultUsers } from "./utils/seed-default-users";

dotenv.config();

const app: Express = express();
const PORT = process.env.PORT || 3000;

// Middleware
const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const fallbackOrigin = "https://marketing.dakyworld.com";
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : [fallbackOrigin];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
app.use(express.json());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/oauth", oauthRoutes);
app.use("/api/posts", postsRoutes);
app.use("/api/integrations", integrationsRoutes);
app.use("/api/automation", automationRoutes);

// Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "OK" });
});

// Error handling
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();
  seedDefaultUsers();
});
