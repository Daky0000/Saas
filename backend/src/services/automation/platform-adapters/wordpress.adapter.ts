import { UserIntegration } from "@prisma/client";

export class WordPressAdapter {
  static async publishPost(
    _content: string,
    _mediaUrl: string | null,
    _userIntegration: UserIntegration
  ) {
    return { success: false, error: "WordPress adapter not implemented" };
  }

  static async validateToken(_accessToken: string) {
    return { valid: false };
  }
}
