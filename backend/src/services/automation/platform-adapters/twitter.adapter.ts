import { UserIntegration } from "@prisma/client";

export class TwitterAdapter {
  static async publishPost(
    _content: string,
    _mediaUrl: string | null,
    _userIntegration: UserIntegration
  ) {
    return { success: false, error: "Twitter adapter not implemented" };
  }

  static async validateToken(_accessToken: string) {
    return { valid: false };
  }

  static async getAccount(_accessToken: string) {
    return null;
  }
}
