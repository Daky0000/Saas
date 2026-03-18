import { UserIntegration } from "@prisma/client";

export class PinterestAdapter {
  static async publishPost(
    _content: string,
    _mediaUrl: string | null,
    _userIntegration: UserIntegration
  ) {
    return { success: false, error: "Pinterest adapter not implemented" };
  }

  static async validateToken(_accessToken: string) {
    return { valid: false };
  }

  static async getAccount(_accessToken: string) {
    return null;
  }
}
