import axios from "axios";
import { UserIntegration } from "@prisma/client";

export class TwitterAdapter {
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

      const response = await axios.post(
        "https://api.twitter.com/2/tweets",
        { text: content },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return {
        success: true,
        platformPostId: response.data.data?.id ?? response.data.id,
        data: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.detail || error.message,
      };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const response = await axios.get("https://api.twitter.com/2/users/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: true, data: response.data };
    } catch {
      return { valid: false };
    }
  }

  static async getAccount(accessToken: string) {
    const response = await axios.get("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return response.data.data;
  }
}
