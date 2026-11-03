import { POST_COPY_WORST_USD, creditsForMagnific, creditsForUsd, economyImageCredits, magnificImageCost, magnificVideoCost } from './aiPricing.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Social post formats: what each platform's post looks like, how to write it,
// which media it needs and what that media costs. Shared by the chat's batch
// writer (generation + estimate), the calendar and the publisher.
// ─────────────────────────────────────────────────────────────────────────────

export type SocialPlatform = 'instagram' | 'facebook' | 'linkedin' | 'x' | 'threads' | 'tiktok' | 'youtube' | 'pinterest';
export type SocialFormat = 'text' | 'single_image' | 'carousel' | 'reel' | 'story' | 'video';

export const SOCIAL_PLATFORMS: SocialPlatform[] = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'youtube', 'pinterest'];

/** The formats each platform supports, first = the default. */
export const PLATFORM_FORMATS: Record<SocialPlatform, SocialFormat[]> = {
  instagram: ['single_image', 'carousel', 'reel', 'story'],
  facebook: ['single_image', 'text', 'carousel', 'video', 'reel'],
  linkedin: ['text', 'single_image', 'carousel', 'video'],
  x: ['text', 'single_image', 'video'],
  threads: ['text', 'single_image', 'carousel'],
  tiktok: ['video'],
  youtube: ['video'],
  pinterest: ['single_image'],
};

/** Image models for social media: the lowest-cost one by default, Magnific One on "best quality". */
export const SOCIAL_IMAGE_MODEL = 'magnific-one';
/** Lowest-cost paid image model (Magnific Z-Image, 5 Magnific credits ≈ $0.005); the free NVIDIA model is tried before it. */
export const ECONOMY_IMAGE_MODEL = 'z-image';
/** Next cheapest if Z-Image fails (Flux.1, ≈ $0.01). */
export const ECONOMY_IMAGE_FALLBACK = 'flux-dev';
export const SOCIAL_VIDEO_MODEL_FROM_IMAGE = 'kling-v2-6-pro';
/** Best-quality video: Kling 3.0 (450 Magnific credits per 5 s, twice Kling 2.6). */
export const QUALITY_VIDEO_MODEL = 'kling-3-0';
/** The video model for a media setting: Kling 2.6 on Lowest cost, Kling 3.0 on Best quality. */
export function socialVideoModel(mode: 'economy' | 'quality' = 'economy'): string {
  return mode === 'quality' ? QUALITY_VIDEO_MODEL : SOCIAL_VIDEO_MODEL_FROM_IMAGE;
}
export const SOCIAL_VIDEO_MODEL_FROM_TEXT = 'ltx-2-pro';
/** Social images: Magnific One at 2k, medium quality (Magnific's standard finished image). */
export const SOCIAL_IMAGE_OPTS = { quality: 'medium', resolution: '2k' } as const;
export const SOCIAL_VIDEO_SECONDS = 5;

// Prices are the provider cost × 1.54, in credits (server/aiPricing.ts).
/** Writing one post: free models normally; priced for the worst case on the paid fallback, never below 2. */
export function socialCopyCredits(): number { return Math.max(2, creditsForUsd(POST_COPY_WORST_USD)); }
/** One image: Best quality = Magnific One × 1.54; Lowest cost = half that, whatever model draws it. */
export function socialImageCredits(mode: 'economy' | 'quality' = 'economy'): number {
  return mode === 'quality'
    ? creditsForMagnific(magnificImageCost(SOCIAL_IMAGE_MODEL, SOCIAL_IMAGE_OPTS))
    : economyImageCredits();
}
/** A video is animated from its cover image, so a reel costs a cover image plus this. */
export function socialVideoCredits(mode: 'economy' | 'quality' = 'economy'): number { return creditsForMagnific(magnificVideoCost(socialVideoModel(mode), { duration: SOCIAL_VIDEO_SECONDS, resolution: '1080p' })); }

export const MIN_SLIDES = 3;
export const MAX_SLIDES = 10;

export function normalizePlatform(raw: unknown): SocialPlatform | null {
  const p = String(raw ?? '').toLowerCase().trim().replace(/^@/, '');
  if (p === 'twitter' || p === 'x' || p === 'x (twitter)') return 'x';
  if (p === 'ig' || p === 'insta') return 'instagram';
  if (p === 'fb') return 'facebook';
  if (p === 'yt' || p === 'youtube shorts' || p === 'shorts') return 'youtube';
  return (SOCIAL_PLATFORMS as string[]).includes(p) ? (p as SocialPlatform) : null;
}

export function normalizeFormat(platform: SocialPlatform, raw: unknown): SocialFormat {
  const f = String(raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const alias: Record<string, SocialFormat> = {
    image: 'single_image', photo: 'single_image', post: 'single_image', feed_post: 'single_image', single: 'single_image', image_post: 'single_image',
    slides: 'carousel', slideshow: 'carousel', document: 'carousel',
    reels: 'reel', short: 'video', shorts: 'video', clip: 'video',
    stories: 'story', tweet: 'text', status: 'text', text_only: 'text', caption: 'text',
  };
  const wanted = (alias[f] ?? f) as SocialFormat;
  const allowed = PLATFORM_FORMATS[platform];
  if (allowed.includes(wanted)) return wanted;
  // Close substitutes: a reel where only "video" exists, and the reverse.
  if (wanted === 'reel' && allowed.includes('video')) return 'video';
  if (wanted === 'video' && allowed.includes('reel')) return 'reel';
  return allowed[0];
}

export function isVideoFormat(format: SocialFormat): boolean {
  return format === 'reel' || format === 'video';
}

/** How many images / videos a post of this shape needs. */
export function mediaPlan(format: SocialFormat, slides?: number, withImage?: boolean): { images: number; videos: number } {
  if (format === 'carousel') return { images: clampSlides(slides), videos: 0 };
  if (format === 'single_image' || format === 'story') return { images: 1, videos: 0 };
  if (isVideoFormat(format)) return { images: 1, videos: 1 };
  return { images: withImage ? 1 : 0, videos: 0 };
}

export function clampSlides(slides?: number): number {
  const n = Math.round(Number(slides) || 5);
  return Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, n));
}

export function postCredits(format: SocialFormat, slides?: number, withImage?: boolean, mode: 'economy' | 'quality' = 'economy'): number {
  const m = mediaPlan(format, slides, withImage);
  return socialCopyCredits() + m.images * socialImageCredits(mode) + m.videos * socialVideoCredits(mode);
}

export function aspectRatioFor(platform: SocialPlatform, format: SocialFormat): string {
  if (isVideoFormat(format) || format === 'story') return '9:16';
  if (platform === 'instagram' || platform === 'threads' || (format === 'carousel' && platform !== 'linkedin')) return '4:5';
  if (platform === 'pinterest') return '2:3';
  if (platform === 'x') return '16:9';
  return '1:1';
}

export const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', tiktok: 'TikTok', youtube: 'YouTube Shorts', pinterest: 'Pinterest',
};

export const FORMAT_LABEL: Record<SocialFormat, string> = {
  text: 'Text post', single_image: 'Image post', carousel: 'Carousel', reel: 'Reel', story: 'Story', video: 'Video',
};

/** Caption limits the publisher enforces (characters). */
export const CAPTION_LIMIT: Record<SocialPlatform, number> = {
  instagram: 2200, facebook: 5000, linkedin: 3000, x: 280, threads: 500, tiktok: 2200, youtube: 1000, pinterest: 500,
};

/** How to write for this platform and format — the brief the writer model follows. */
export function writingRules(platform: SocialPlatform, format: SocialFormat): string {
  const base: Record<SocialPlatform, string> = {
    instagram: 'Instagram caption: a scroll-stopping first line (the hook shows before "more"), short paragraphs with line breaks, 1–3 relevant emojis at most, a clear call to action (save, share, comment, link in bio), then 5–10 targeted hashtags on their own line at the end. Max 2,200 characters; aim for 80–220 words. No links (they are not clickable).',
    facebook: 'Facebook post: conversational, 40–120 words, a question or a clear call to action to drive comments, 0–3 hashtags. Links are fine.',
    linkedin: 'LinkedIn post: a 1–2 line hook that earns the "see more" click, then short scannable lines with white space, a professional but human voice, a concrete takeaway or story, and a closing question. 120–250 words, 3–5 hashtags at the end. No emoji walls.',
    x: 'X (Twitter) post: ONE tweet, at most 270 characters including hashtags, punchy and specific, 0–2 hashtags. No threads, no "1/".',
    threads: 'Threads post: casual and conversational, at most 450 characters, invites replies, 0–3 hashtags (Threads uses one topic tag best).',
    tiktok: 'TikTok caption: at most 150 characters, curiosity hook, 3–5 hashtags including one broad and some niche ones.',
    youtube: 'YouTube Shorts title + description: a title under 70 characters, then 1–2 sentences and 3 hashtags including #Shorts.',
    pinterest: 'Pinterest pin: a keyword-rich title under 100 characters and a description of 1–3 sentences (max 500 characters) with natural search keywords. No hashtag walls.',
  };
  const shape: Record<SocialFormat, string> = {
    text: 'This is a text-only post: the words carry everything.',
    single_image: 'This post is one image plus the caption. Describe the image to generate in image_prompt; the caption should complement the image, not describe it.',
    carousel: 'This is a carousel. Write the slides: slide 1 is a bold hook (max 8 words), the middle slides each deliver ONE point (headline max 8 words + body max 25 words), the last slide is a call to action. The caption summarises and tells people to swipe. Give ONE visual_style shared by every slide so they look like a set (palette, typography, layout, background).',
    reel: 'This is a short vertical video (Reel). Write video_prompt: the action and camera movement for 5–10 seconds, vertical 9:16, no on-screen text. Write image_prompt for the cover frame. The caption hooks the viewer and adds context.',
    story: 'This is a vertical Story (9:16): one image with very little text and one call to action. Keep the caption short (it is not shown on Stories; use it as an internal note).',
    video: 'This is a short vertical video. Write video_prompt: the action and camera movement for 5–10 seconds, no on-screen text. Write image_prompt for the cover frame.',
  };
  return `${base[platform]}\n${shape[format]}`;
}

export interface SocialPiece {
  title: string;
  caption: string;
  hashtags: string[];
  image_prompt: string;
  video_prompt: string;
  visual_style: string;
  alt_text: string;
  slides: Array<{ headline: string; body: string }>;
}

/** The JSON shape the writer returns, for the prompt. */
export function pieceSchema(format: SocialFormat, slides: number): string {
  const slideHint = format === 'carousel'
    ? `, "visual_style": "one shared look for every slide", "slides": [${Array.from({ length: slides }, (_, i) => `{"headline": "slide ${i + 1} headline", "body": "${i === 0 ? 'short subline or empty' : 'max 25 words'}"}`).join(', ')}]`
    : '';
  const media = format === 'text' ? '' : ', "image_prompt": "a vivid, specific image-generation prompt under 70 words: subject, setting, lighting, composition, style. No text in the image unless essential", "alt_text": "one-sentence description for accessibility"';
  const video = isVideoFormat(format) ? ', "video_prompt": "the motion: action and camera movement for 5–10 seconds"' : '';
  return `{"title": "a short internal label (max 60 chars)", "caption": "the post text exactly as it should be published, without the hashtags", "hashtags": ["tag", "tag"]${media}${video}${slideHint}}`;
}

export function parsePiece(raw: string, format: SocialFormat, slides: number): SocialPiece {
  let j: any = {};
  try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { j = { caption: raw }; }
  const tags = Array.isArray(j.hashtags) ? j.hashtags : typeof j.hashtags === 'string' ? j.hashtags.split(/[\s,]+/) : [];
  const piece: SocialPiece = {
    title: String(j.title || '').trim().slice(0, 120),
    caption: String(j.caption ?? j.content ?? '').trim(),
    hashtags: tags.map((t: unknown) => String(t).trim().replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).slice(0, 15),
    image_prompt: String(j.image_prompt || '').trim().slice(0, 1200),
    video_prompt: String(j.video_prompt || '').trim().slice(0, 1200),
    visual_style: String(j.visual_style || '').trim().slice(0, 600),
    alt_text: String(j.alt_text || '').trim().slice(0, 300),
    slides: Array.isArray(j.slides)
      ? j.slides.map((s: any) => ({ headline: String(s?.headline || '').trim().slice(0, 120), body: String(s?.body || '').trim().slice(0, 300) })).filter((s: any) => s.headline || s.body)
      : [],
  };
  if (format === 'carousel') piece.slides = piece.slides.slice(0, slides);
  return piece;
}

/** The text that is published: caption plus hashtags, fitted to the platform's limit. */
export function publishText(platform: SocialPlatform, piece: Pick<SocialPiece, 'caption' | 'hashtags'>): string {
  const tags = piece.hashtags.map((t) => `#${t}`).join(' ');
  const limit = CAPTION_LIMIT[platform];
  let caption = piece.caption.trim();
  const join = platform === 'instagram' || platform === 'linkedin' || platform === 'tiktok' ? '\n\n' : ' ';
  let text = tags ? `${caption}${join}${tags}` : caption;
  if (text.length > limit) {
    // Drop hashtags first, then trim the caption.
    text = caption.length <= limit ? caption : `${caption.slice(0, limit - 1).trimEnd()}…`;
    caption = text;
  }
  return text;
}

/** Image prompt for one carousel slide, in the set's shared style. */
export function slidePrompt(style: string, slide: { headline: string; body: string }, index: number, total: number, aspect: string): string {
  return [
    `Slide ${index + 1} of ${total} of a social media carousel, ${aspect} format.`,
    `Shared visual style for the whole set (keep identical across slides): ${style || 'clean modern editorial design, consistent brand palette, bold sans-serif typography, generous margins'}.`,
    `Large, legible headline text on the slide: "${slide.headline}".`,
    slide.body ? `Smaller supporting text: "${slide.body}".` : '',
    index === 0 ? 'This is the cover slide: the strongest visual, designed to stop the scroll.' : '',
    index === total - 1 ? 'This is the closing slide: a clear call to action.' : '',
  ].filter(Boolean).join(' ');
}

// ── Best times to post ───────────────────────────────────────────────────────
//
// Local time in the user's timezone. Hours and days follow the platform
// engagement studies (Sprout Social / Hootsuite / Later, 2024–2026): mid-week
// mornings for LinkedIn and X, late morning for Instagram, evenings for
// TikTok and Pinterest.

export const BEST_TIMES: Record<SocialPlatform, { hour: number; minute: number; days: number[]; why: string }> = {
  instagram: { hour: 11, minute: 0, days: [1, 2, 3, 4, 5], why: 'weekday late morning' },
  facebook: { hour: 9, minute: 0, days: [1, 2, 3, 4, 5], why: 'weekday morning' },
  linkedin: { hour: 8, minute: 30, days: [2, 3, 4], why: 'Tue–Thu before work' },
  x: { hour: 9, minute: 0, days: [1, 2, 3, 4, 5], why: 'weekday morning' },
  threads: { hour: 12, minute: 0, days: [1, 2, 3, 4, 5], why: 'weekday lunchtime' },
  tiktok: { hour: 19, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], why: 'evening' },
  youtube: { hour: 15, minute: 0, days: [4, 5, 6], why: 'Thu–Sat afternoon' },
  pinterest: { hour: 20, minute: 0, days: [0, 5, 6], why: 'Fri–Sun evening' },
};

export function validTimeZone(tz: unknown): string {
  const t = String(tz || '').trim();
  if (!t) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: t }); return t; } catch { return 'UTC'; }
}

/** The calendar date (y, m, d, weekday) of an instant in a timezone. */
function localParts(at: Date, tz: string): { y: number; m: number; d: number; wd: number; h: number; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(at).reduce((o, p) => ({ ...o, [p.type]: p.value }), {} as Record<string, string>);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { y: +parts.year, m: +parts.month, d: +parts.day, wd, h: +parts.hour % 24, min: +parts.minute };
}

/** The UTC instant of a local wall-clock time in a timezone. */
export function zonedTime(y: number, m: number, d: number, h: number, min: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const p = localParts(new Date(guess), tz);
  const asLocal = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min);
  return new Date(guess - (asLocal - guess));
}

/**
 * The best slot for a platform on or after `dayOffset` days from today (in the
 * user's timezone), moved forward to the platform's best weekday when needed.
 */
export function bestSlot(platform: SocialPlatform, dayOffset: number, tz: string, now = new Date()): Date {
  const best = BEST_TIMES[platform];
  const today = localParts(now, tz);
  for (let extra = 0; extra < 8; extra++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + dayOffset + extra));
    const wd = base.getUTCDay();
    if (!best.days.includes(wd)) continue;
    const at = zonedTime(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), best.hour, best.minute, tz);
    if (at.getTime() > now.getTime() + 30 * 60_000) return at;
  }
  return zonedTime(today.y, today.m, today.d + dayOffset + 1, best.hour, best.minute, tz);
}

/** One line for the planner: when to post on each platform, in the user's time. */
export function bestTimesGuide(tz: string): string {
  return `Best posting times (the user's local time, ${tz}): ` + SOCIAL_PLATFORMS
    .map((p) => `${PLATFORM_LABEL[p]} ${String(BEST_TIMES[p].hour).padStart(2, '0')}:${String(BEST_TIMES[p].minute).padStart(2, '0')} (${BEST_TIMES[p].why})`)
    .join('; ') + '.';
}
