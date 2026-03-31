import axios from "axios";

const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export class TikTokAdapter {
  static async getAccountProfile(openId: string, accessToken: string) {
    try {
      const resp = await axios.get(`${TIKTOK_API_BASE}/user/info/`, {
        params: {
          fields: "open_id,union_id,avatar_url,display_name,username",
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const user = resp.data?.data?.user || {};
      return {
        username: user.username || user.display_name || "",
        followers: 0, // TikTok doesn't provide follower count via this endpoint
        followings: 0,
        total_likes: 0,
        bio: null,
        verified: false,
        raw: user,
      };
    } catch (error: any) {
      return { error: error?.message || "TikTok profile fetch failed" };
    }
  }
}
