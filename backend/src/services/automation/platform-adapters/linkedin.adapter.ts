import axios from "axios";
import { UserIntegration } from "@prisma/client";

export class LinkedInAdapter {
  static async publishPost(
    content: string,
    _mediaUrl: string | null,
    userIntegration: UserIntegration
  ) {
    try {
      const accessToken = userIntegration.accessToken;
      if (!accessToken) {
        return { success: false, error: "Missing access token" };
      }

      const payload = {
        author: `urn:li:person:${userIntegration.accountId}`,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text: content },
            shareMediaCategory: "NONE",
          },
        },
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC",
        },
      };

      const response = await axios.post(
        "https://api.linkedin.com/v2/ugcPosts",
        payload,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return {
        success: true,
        platformPostId: response.data.id,
        data: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const response = await axios.get("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: true, data: response.data };
    } catch {
      return { valid: false };
    }
  }

  static async getAccount(accessToken: string) {
    const response = await axios.get("https://api.linkedin.com/v2/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data;
  }
}
