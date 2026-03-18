import axios from "axios";
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

type AccountPayload = {
  accountId: string;
  accountName: string;
  accountEmail?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
};

const toForm = (params: Record<string, string>) =>
  new URLSearchParams(params);

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

  static getOAuthUrl(slug: string, state: string, codeChallenge?: string): string {
    const redirectBase = process.env.BACKEND_URL || "";
    const urls: Record<string, string> = {
      facebook: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${process.env.FACEBOOK_APP_ID}&redirect_uri=${redirectBase}/api/integrations/facebook/callback&scope=pages_manage_posts,pages_read_engagement,public_profile,email&state=${state}`,
      instagram: `https://api.instagram.com/oauth/authorize?client_id=${process.env.INSTAGRAM_APP_ID}&redirect_uri=${redirectBase}/api/integrations/instagram/callback&scope=instagram_basic,instagram_insights&response_type=code&state=${state}`,
      twitter: `https://twitter.com/i/oauth2/authorize?client_id=${process.env.TWITTER_CLIENT_ID}&redirect_uri=${redirectBase}/api/integrations/twitter/callback&response_type=code&scope=tweet.write%20tweet.read%20users.read&state=${state}&code_challenge=${codeChallenge ?? ""}&code_challenge_method=plain`,
      linkedin: `https://www.linkedin.com/oauth/v2/authorization?client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${redirectBase}/api/integrations/linkedin/callback&response_type=code&scope=w_member_social%20r_liteprofile&state=${state}`,
      pinterest: `https://www.pinterest.com/oauth/?client_id=${process.env.PINTEREST_APP_ID}&redirect_uri=${redirectBase}/api/integrations/pinterest/callback&response_type=code&scope=pins:read,pins:write&state=${state}`,
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
    payload: AccountPayload
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

  static async logIntegrationEvent(
    userId: string,
    integrationId: string,
    eventType: string,
    status: string,
    response?: unknown,
    errorMessage?: string
  ) {
    await prisma.integrationLog.create({
      data: {
        userId,
        integrationId,
        eventType,
        status,
        response: response ? (response as object) : undefined,
        errorMessage,
      },
    });
  }

  static async handleOAuthCallback(
    slug: string,
    code: string,
    userId: string,
    codeVerifier?: string
  ) {
    const integration = await this.getIntegration(slug);
    if (!integration) {
      throw new Error("Integration not found");
    }

    let accounts: AccountPayload[] = [];

    try {
      if (slug === "facebook") {
        accounts = await this.exchangeFacebook(code);
      } else if (slug === "instagram") {
        accounts = [await this.exchangeInstagram(code)];
      } else if (slug === "twitter") {
        accounts = [await this.exchangeTwitter(code, codeVerifier)];
      } else if (slug === "linkedin") {
        accounts = [await this.exchangeLinkedIn(code)];
      } else if (slug === "pinterest") {
        accounts = [await this.exchangePinterest(code)];
      } else {
        throw new Error("OAuth flow not implemented for this integration");
      }

      const connected = await Promise.all(
        accounts.map((account) =>
          this.connectIntegration(userId, integration.id, account)
        )
      );

      await this.logIntegrationEvent(
        userId,
        integration.id,
        "connection_attempt",
        "success",
        { count: connected.length }
      );

      return connected;
    } catch (error: any) {
      await this.logIntegrationEvent(
        userId,
        integration.id,
        "connection_attempt",
        "failed",
        undefined,
        error?.message
      );
      throw error;
    }
  }

  static async exchangeFacebook(code: string): Promise<AccountPayload[]> {
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/facebook/callback`;
    const tokenResponse = await axios.get(
      "https://graph.facebook.com/v18.0/oauth/access_token",
      {
        params: {
          client_id: process.env.FACEBOOK_APP_ID,
          client_secret: process.env.FACEBOOK_APP_SECRET,
          redirect_uri: redirectUri,
          code,
        },
      }
    );

    const { access_token, expires_in } = tokenResponse.data as {
      access_token: string;
      expires_in?: number;
    };

    const pagesResponse = await axios.get(
      "https://graph.facebook.com/v18.0/me/accounts",
      {
        params: { access_token },
      }
    );

    const pages = pagesResponse.data?.data ?? [];

    return pages.map((page: any) => ({
      accountId: page.id,
      accountName: page.name,
      accessToken: page.access_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    }));
  }

  static async exchangeInstagram(code: string): Promise<AccountPayload> {
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/instagram/callback`;
    const tokenResponse = await axios.post(
      "https://api.instagram.com/oauth/access_token",
      toForm({
        client_id: process.env.INSTAGRAM_APP_ID || "",
        client_secret: process.env.INSTAGRAM_APP_SECRET || "",
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token } = tokenResponse.data as { access_token: string };

    const userResponse = await axios.get(
      "https://graph.instagram.com/me",
      {
        params: { fields: "id,username", access_token },
      }
    );

    return {
      accountId: userResponse.data.id,
      accountName: userResponse.data.username,
      accessToken: access_token,
    };
  }

  static async exchangeTwitter(
    code: string,
    codeVerifier?: string
  ): Promise<AccountPayload> {
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/twitter/callback`;
    const credentials = Buffer.from(
      `${process.env.TWITTER_CLIENT_ID}:${process.env.TWITTER_CLIENT_SECRET}`
    ).toString("base64");

    const tokenResponse = await axios.post(
      "https://api.twitter.com/2/oauth2/token",
      toForm({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || "",
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const userResponse = await axios.get("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    return {
      accountId: userResponse.data.data.id,
      accountName: userResponse.data.data.username,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    };
  }

  static async exchangeLinkedIn(code: string): Promise<AccountPayload> {
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/linkedin/callback`;
    const tokenResponse = await axios.post(
      "https://www.linkedin.com/oauth/v2/accessToken",
      toForm({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID || "",
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || "",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const { access_token, expires_in } = tokenResponse.data as {
      access_token: string;
      expires_in?: number;
    };

    const profileResponse = await axios.get("https://api.linkedin.com/v2/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    const first = profileResponse.data.localizedFirstName || "";
    const last = profileResponse.data.localizedLastName || "";

    return {
      accountId: profileResponse.data.id,
      accountName: `${first} ${last}`.trim() || "LinkedIn Member",
      accessToken: access_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    };
  }

  static async exchangePinterest(code: string): Promise<AccountPayload> {
    const redirectUri = `${process.env.BACKEND_URL}/api/integrations/pinterest/callback`;
    const credentials = Buffer.from(
      `${process.env.PINTEREST_APP_ID}:${process.env.PINTEREST_APP_SECRET}`
    ).toString("base64");

    const tokenResponse = await axios.post(
      "https://api.pinterest.com/v5/oauth/token",
      toForm({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    const accountResponse = await axios.get(
      "https://api.pinterest.com/v5/user_account",
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    return {
      accountId: accountResponse.data.id,
      accountName: accountResponse.data.username || accountResponse.data.name,
      accessToken: access_token,
      refreshToken: refresh_token,
      tokenExpiry: expires_in ? new Date(Date.now() + expires_in * 1000) : null,
    };
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
