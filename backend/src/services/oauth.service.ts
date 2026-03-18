import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class OAuthService {
  // Instagram OAuth
  static getInstagramAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID || "",
      redirect_uri: `${process.env.BACKEND_URL}/api/oauth/instagram/callback`,
      scope: "instagram_basic,instagram_insights",
      response_type: "code",
      state,
    });
    return `https://api.instagram.com/oauth/authorize?${params.toString()}`;
  }

  static async handleInstagramCallback(code: string, agencyId: string) {
    try {
      // Exchange code for token
      const response = await axios.post(
        "https://graph.instagram.com/v18.0/access_token",
        {
          client_id: process.env.INSTAGRAM_APP_ID,
          client_secret: process.env.INSTAGRAM_APP_SECRET,
          grant_type: "authorization_code",
          redirect_uri: `${process.env.BACKEND_URL}/api/oauth/instagram/callback`,
          code,
        }
      );

      const { access_token } = response.data;

      // Get user info
      const userResponse = await axios.get(
        `https://graph.instagram.com/me?fields=id,username&access_token=${access_token}`
      );

      const { username } = userResponse.data;

      // Save to database
      const account = await prisma.socialAccount.upsert({
        where: {
          agencyId_platform_accountUsername: {
            agencyId,
            platform: "instagram",
            accountUsername: username,
          },
        },
        update: {
          oauthToken: access_token,
          isConnected: true,
        },
        create: {
          agencyId,
          platform: "instagram",
          accountUsername: username,
          accountName: username,
          oauthToken: access_token,
          isConnected: true,
        },
      });

      return account;
    } catch {
      throw new Error("Failed to connect Instagram account");
    }
  }

  // TikTok OAuth
  static getTikTokAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_ID || "",
      redirect_uri: `${process.env.BACKEND_URL}/api/oauth/tiktok/callback`,
      scope: "user.info.basic,video.upload",
      response_type: "code",
      state,
    });
    return `https://www.tiktok.com/v1/oauth/authorize?${params.toString()}`;
  }

  static async handleTikTokCallback(code: string, agencyId: string) {
    try {
      // Exchange code for token
      const response = await axios.post(
        "https://open.tiktokapis.com/v1/oauth/token/",
        {
          client_key: process.env.TIKTOK_CLIENT_ID,
          client_secret: process.env.TIKTOK_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
          redirect_uri: `${process.env.BACKEND_URL}/api/oauth/tiktok/callback`,
        }
      );

      const { access_token } = response.data;

      // Get user info
      const userResponse = await axios.get(
        "https://open.tiktokapis.com/v1/user/info/",
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );

      const username = userResponse.data.data.user.display_name;

      // Save to database
      const account = await prisma.socialAccount.upsert({
        where: {
          agencyId_platform_accountUsername: {
            agencyId,
            platform: "tiktok",
            accountUsername: username,
          },
        },
        update: {
          oauthToken: access_token,
          isConnected: true,
        },
        create: {
          agencyId,
          platform: "tiktok",
          accountUsername: username,
          accountName: username,
          oauthToken: access_token,
          isConnected: true,
        },
      });

      return account;
    } catch {
      throw new Error("Failed to connect TikTok account");
    }
  }

  // LinkedIn OAuth
  static getLinkedInAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID || "",
      redirect_uri: `${process.env.BACKEND_URL}/api/oauth/linkedin/callback`,
      scope: "w_member_social,r_liteprofile",
      state,
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  static async handleLinkedInCallback(code: string, agencyId: string) {
    try {
      // Exchange code for token
      const response = await axios.post(
        "https://www.linkedin.com/oauth/v2/accessToken",
        {
          grant_type: "authorization_code",
          code,
          redirect_uri: `${process.env.BACKEND_URL}/api/oauth/linkedin/callback`,
          client_id: process.env.LINKEDIN_CLIENT_ID,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET,
        }
      );

      const { access_token } = response.data;

      // Get user info
      const userResponse = await axios.get("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const username = `${userResponse.data.localizedFirstName} ${userResponse.data.localizedLastName}`;

      // Save to database
      const account = await prisma.socialAccount.upsert({
        where: {
          agencyId_platform_accountUsername: {
            agencyId,
            platform: "linkedin",
            accountUsername: username,
          },
        },
        update: {
          oauthToken: access_token,
          isConnected: true,
        },
        create: {
          agencyId,
          platform: "linkedin",
          accountUsername: username,
          accountName: username,
          oauthToken: access_token,
          isConnected: true,
        },
      });

      return account;
    } catch {
      throw new Error("Failed to connect LinkedIn account");
    }
  }

  // Twitter OAuth
  static getTwitterAuthUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.TWITTER_CLIENT_ID || "",
      redirect_uri: `${process.env.BACKEND_URL}/api/oauth/twitter/callback`,
      scope: "tweet.write tweet.read users.read",
      state,
      code_challenge: state, // PKCE
      code_challenge_method: "plain",
    });
    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  static async handleTwitterCallback(
    code: string,
    agencyId: string,
    codeVerifier: string
  ) {
    try {
      // Exchange code for token
      const response = await axios.post("https://twitter.com/2/oauth2/token", {
        grant_type: "authorization_code",
        code,
        redirect_uri: `${process.env.BACKEND_URL}/api/oauth/twitter/callback`,
        client_id: process.env.TWITTER_CLIENT_ID,
        client_secret: process.env.TWITTER_CLIENT_SECRET,
        code_verifier: codeVerifier,
      });

      const { access_token } = response.data;

      // Get user info
      const userResponse = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      const username = userResponse.data.data.username;

      // Save to database
      const account = await prisma.socialAccount.upsert({
        where: {
          agencyId_platform_accountUsername: {
            agencyId,
            platform: "twitter",
            accountUsername: username,
          },
        },
        update: {
          oauthToken: access_token,
          isConnected: true,
        },
        create: {
          agencyId,
          platform: "twitter",
          accountUsername: username,
          accountName: username,
          oauthToken: access_token,
          isConnected: true,
        },
      });

      return account;
    } catch {
      throw new Error("Failed to connect Twitter account");
    }
  }
}
