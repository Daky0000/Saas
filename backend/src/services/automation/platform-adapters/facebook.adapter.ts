import axios from "axios";
import { UserIntegration } from "@prisma/client";

export class FacebookAdapter {
  static async publishPost(
    content: string,
    mediaUrl: string | null,
    userIntegration: UserIntegration
  ) {
    try {
      const pageId = userIntegration.accountId;
      const accessToken = userIntegration.accessToken;

      if (!accessToken) {
        return { success: false, error: "Missing access token" };
      }

      const data: Record<string, any> = {
        message: content,
        access_token: accessToken,
      };

      if (mediaUrl) {
        data.url = mediaUrl;
      }

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/${pageId}/feed`,
        data
      );

      return {
        success: true,
        platformPostId: response.data.id,
        data: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error?.message || error.message,
      };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const response = await axios.get(
        `https://graph.facebook.com/me?access_token=${accessToken}`
      );
      return { valid: true, data: response.data };
    } catch {
      return { valid: false };
    }
  }

  static async getPages(accessToken: string) {
    const response = await axios.get(
      `https://graph.facebook.com/me/accounts?access_token=${accessToken}`
    );
    return response.data.data;
  }
}
