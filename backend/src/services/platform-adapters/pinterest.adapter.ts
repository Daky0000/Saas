import axios from "axios";
import { UserIntegration } from "@prisma/client";
import { logIntegrationEvent } from "../../utils/integration-log";

export class PinterestAdapter {
  static async publishPin(
    content: string,
    imageUrl: string,
    userIntegration: UserIntegration
  ) {
    const accessToken = userIntegration.accessToken || "";
    const boardId = userIntegration.accountId;

    try {
      const resp = await axios.post(
        "https://api.pinterest.com/v5/pins",
        {
          title: content.slice(0, 100),
          description: content,
          board_id: boardId,
          media_source: { source_type: "image_url", url: imageUrl },
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      return { success: true, platformPostId: resp.data?.id };
    } catch (error: any) {
      await logIntegrationEvent({
        userId: userIntegration.userId,
        integrationId: userIntegration.integrationId,
        userIntegrationId: userIntegration.id,
        eventType: "post_publish",
        status: "failed",
        errorMessage: error?.message || "Pinterest publish failed",
      });
      return {
        success: false,
        error:
          error?.response?.data?.message ||
          error?.message ||
          "Pinterest publish failed",
      };
    }
  }

  static async validateToken(accessToken: string) {
    try {
      const resp = await axios.get("https://api.pinterest.com/v5/user_account", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { valid: resp.status < 400 };
    } catch {
      return { valid: false };
    }
  }

  static async getBoards(accessToken: string) {
    try {
      const resp = await axios.get("https://api.pinterest.com/v5/boards", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.data?.items || [];
    } catch {
      return [];
    }
  }
  static async getBoardMetrics(
    boardId: string,
    accessToken: string,
    _dateRange: { start: Date; end: Date }
  ) {
    try {
      const resp = await axios.get(
        `https://api.pinterest.com/v5/boards/${boardId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return {
        posts: 0,
        impressions: 0,
        reach: 0,
        engagement: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        saves: 0,
        raw: resp.data,
      };
    } catch (error: any) {
      return { error: error?.message || "Pinterest metrics failed" };
    }
  }\n}
