import { ConnectionStatus, PrismaClient } from "@prisma/client";
import { decryptToken, encryptToken } from "../utils/encryption";

const prisma = new PrismaClient();

const DEFAULT_INTEGRATIONS = [
  { name: "Facebook", slug: "facebook", type: "social" },
  { name: "Instagram", slug: "instagram", type: "social" },
  { name: "Twitter", slug: "twitter", type: "social" },
  { name: "LinkedIn", slug: "linkedin", type: "social" },
  { name: "Pinterest", slug: "pinterest", type: "social" },
  { name: "WordPress", slug: "wordpress", type: "cms" },
];

export class IntegrationService {
  static async ensureDefaults() {
    const existing = await prisma.integration.findMany({
      select: { slug: true },
    });
    const existingSlugs = new Set(existing.map((item) => item.slug));

    const missing = DEFAULT_INTEGRATIONS.filter(
      (item) => !existingSlugs.has(item.slug)
    );

    if (!missing.length) return;

    await prisma.integration.createMany({ data: missing });
  }

  static async getIntegrations() {
    await this.ensureDefaults();
    return prisma.integration.findMany({ orderBy: { name: "asc" } });
  }

  static async getIntegration(slug: string) {
    return prisma.integration.findUnique({ where: { slug } });
  }

  static getOAuthUrl(slug: string, state: string): string {
    const urls: Record<string, string> = {
      facebook: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${process.env.BACKEND_URL}/api/integrations/facebook/callback&scope=pages_manage_posts,pages_read_engagement,public_profile,email&state=${state}`,
      instagram: `https://api.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_APP_ID}&redirect_uri=${process.env.BACKEND_URL}/api/integrations/instagram/callback&scope=instagram_basic,instagram_insights&response_type=code&state=${state}`,
      twitter: `https://twitter.com/i/oauth2/authorize?client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${process.env.BACKEND_URL}/api/integrations/twitter/callback&response_type=code&scope=tweet.write%20tweet.read%20users.read&state=${state}&code_challenge=${state}&code_challenge_method=plain`,
      linkedin: `https://www.linkedin.com/oauth/v2/authorization?client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${process.env.BACKEND_URL}/api/integrations/linkedin/callback&response_type=code&scope=w_member_social%20r_liteprofile&state=${state}`,
      pinterest: `https://api.pinterest.com/v1/oauth/?client_id=${process.env.PINTEREST_APP_ID}&redirect_uri=${process.env.BACKEND_URL}/api/integrations/pinterest/callback&response_type=code&scope=pins:read,pins:write&state=${state}`,
    };

    return urls[slug] || "";
  }

  static async getUserIntegrations(userId: string) {
    return prisma.userIntegration.findMany({
      where: { userId },
      include: { integration: true },
      orderBy: { createdAt: "desc" },
    });
  }

  static async connectIntegration(
    userId: string,
    integrationId: string,
    payload: {
      accountId: string;
      accountName: string;
      accountEmail?: string | null;
      accessToken?: string | null;
      refreshToken?: string | null;
      tokenExpiry?: Date | null;
    }
  ) {
    const encryptedAccess = payload.accessToken
      ? encryptToken(payload.accessToken)
      : null;
    const encryptedRefresh = payload.refreshToken
      ? encryptToken(payload.refreshToken)
      : null;

    return prisma.userIntegration.upsert({
      where: {
        userId_integrationId_accountId: {
          userId,
          integrationId,
          accountId: payload.accountId,
        },
      },
      update: {
        accountName: payload.accountName,
        accountEmail: payload.accountEmail ?? undefined,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry: payload.tokenExpiry ?? undefined,
        status: ConnectionStatus.CONNECTED,
      },
      create: {
        userId,
        integrationId,
        accountId: payload.accountId,
        accountName: payload.accountName,
        accountEmail: payload.accountEmail ?? undefined,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        tokenExpiry: payload.tokenExpiry ?? undefined,
        status: ConnectionStatus.CONNECTED,
      },
    });
  }

  static async disconnectIntegration(userId: string, userIntegrationId: string) {
    const integration = await prisma.userIntegration.findFirst({
      where: { id: userIntegrationId, userId },
    });

    if (!integration) {
      throw new Error("Integration not found");
    }

    return prisma.userIntegration.update({
      where: { id: userIntegrationId },
      data: {
        status: ConnectionStatus.DISCONNECTED,
        accessToken: null,
        refreshToken: null,
      },
    });
  }

  static async refreshToken(_userIntegrationId: string) {
    throw new Error("Token refresh not implemented yet");
  }

  static encryptToken(token: string) {
    return encryptToken(token);
  }

  static decryptToken(token: string) {
    return decryptToken(token);
  }
}
