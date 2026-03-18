const platformLimits: Record<
  string,
  { charLimit: number; mediaTypes: string[] }
> = {
  instagram: { charLimit: 2200, mediaTypes: ["image", "video"] },
  tiktok: { charLimit: 2200, mediaTypes: ["video"] },
  linkedin: { charLimit: 3000, mediaTypes: ["image", "video"] },
  twitter: { charLimit: 280, mediaTypes: ["image", "video", "gif"] },
  facebook: { charLimit: 63206, mediaTypes: ["image", "video"] },
  pinterest: { charLimit: 500, mediaTypes: ["image", "video"] },
  wordpress: { charLimit: 100000, mediaTypes: ["image", "video"] },
};

export const getPlatformLimits = (platform: string) => {
  return platformLimits[platform] || { charLimit: 2000, mediaTypes: [] };
};

export const sanitizeContent = (content: string, platform: string) => {
  const trimmed = content.trim().replace(/\s+/g, " ");
  const { charLimit } = getPlatformLimits(platform);
  if (trimmed.length <= charLimit) return trimmed;
  return trimmed.slice(0, charLimit - 1);
};

export const formatContent = (content: string, platform: string) => {
  return sanitizeContent(content, platform);
};

export const validateMediaUrl = (url: string, platform: string): boolean => {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    const { mediaTypes } = getPlatformLimits(platform);
    if (!mediaTypes.length) return false;
    return true;
  } catch {
    return false;
  }
};
