import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertCircle,
  Bookmark,
  CheckCircle2,
  Heart,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Repeat2,
  Send,
  Share2,
  ThumbsUp,
} from 'lucide-react';
import { blogService, type BlogPost } from '../../services/blogService';
import { socialTemplateService, type SocialTemplatePreview, type SocialTemplateSettings } from '../../services/socialTemplateService';
import { PlatformLogo } from '../PlatformLogo';
import { getNetworkConfig } from './networkConfig';

const HASHTAG_REGEX = /#[\p{L}0-9_]+/gu;

function formatHashtags(text: string) {
  const value = String(text || '');
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;

  for (const match of value.matchAll(HASHTAG_REGEX)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const tag = match[0] || '';
    if (!tag) continue;

    if (index > lastIndex) {
      nodes.push(value.slice(lastIndex, index));
    }

    nodes.push(
      <span key={`tag-${key++}-${index}`} className="font-bold text-blue-700">
        {tag}
      </span>
    );

    lastIndex = index + tag.length;
  }

  if (lastIndex < value.length) {
    nodes.push(value.slice(lastIndex));
  }

  return nodes.length ? nodes : value;
}

function PreviewImage({ url, aspectClass }: { url: string; aspectClass: string }) {
  const src = String(url || '').trim();
  if (!src) {
    return (
      <div className={`w-full ${aspectClass} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center`}>
        <div className="flex flex-col items-center text-slate-400">
          <ImageIcon size={28} className="mb-2" />
          <div className="text-xs font-semibold">No featured image</div>
        </div>
      </div>
    );
  }

  return <img src={src} alt="Featured" className={`w-full ${aspectClass} object-cover`} />;
}

function InstagramPreviewCard({ platform, caption, imageUrl }: { platform: string; caption: string; imageUrl: string }) {
  const username = platform === 'threads' ? 'your_threads' : 'your_instagram';
  return (
    <div className="max-w-[420px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform={platform} size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{username}</div>
          <div className="text-xs text-slate-500">Preview</div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <PreviewImage url={imageUrl} aspectClass="aspect-square" />

      <div className="space-y-2 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-slate-800">
            <Heart size={18} className="hover:text-rose-500" />
            <MessageCircle size={18} />
            <Send size={18} />
          </div>
          <Bookmark size={18} className="text-slate-800" />
        </div>

        <div className="text-xs font-semibold text-slate-800">1,245 likes</div>

        <div className="text-sm text-slate-800 whitespace-pre-wrap break-words">
          <span className="font-semibold">{username}</span> <span>{formatHashtags(caption)}</span>
        </div>

        <div className="text-[11px] text-slate-400">Just now</div>
      </div>
    </div>
  );
}

function FacebookPreviewCard({ platform, caption, imageUrl }: { platform: string; caption: string; imageUrl: string }) {
  const name = platform === 'linkedin' ? 'Your Company' : 'Your Page';
  const subtitle = platform === 'linkedin' ? '1h • Public' : 'Just now • Public';
  const actionLabels =
    platform === 'linkedin'
      ? [
          { label: 'Like', icon: ThumbsUp },
          { label: 'Comment', icon: MessageCircle },
          { label: 'Repost', icon: Repeat2 },
          { label: 'Send', icon: Send },
        ]
      : [
          { label: 'Like', icon: ThumbsUp },
          { label: 'Comment', icon: MessageCircle },
          { label: 'Share', icon: Share2 },
        ];

  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform={platform} size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
          <div className="text-xs text-slate-500">{subtitle}</div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="px-4 pb-3 text-sm text-slate-800 whitespace-pre-wrap break-words">
        {formatHashtags(caption)}
      </div>

      <PreviewImage url={imageUrl} aspectClass="aspect-[16/9]" />

      <div className="border-t border-slate-100 px-2 py-2">
        <div className="flex items-center justify-around text-xs font-semibold text-slate-600">
          {actionLabels.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-slate-50"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TwitterPreviewCard({ caption, imageUrl }: { caption: string; imageUrl: string }) {
  return (
    <div className="max-w-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-3 px-4 py-3">
        <div className="mt-0.5 h-9 w-9 overflow-hidden rounded-full bg-slate-100 flex items-center justify-center">
          <PlatformLogo platform="twitter" size={30} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-900">Your Name</span>
            <span className="text-sm text-slate-500">@yourhandle · 1m</span>
          </div>
          <div className="mt-1 text-sm text-slate-800 whitespace-pre-wrap break-words">{formatHashtags(caption)}</div>

          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            <PreviewImage url={imageUrl} aspectClass="aspect-[16/9]" />
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span className="inline-flex items-center gap-1">
              <MessageCircle size={14} /> 12
            </span>
            <span className="inline-flex items-center gap-1">
              <Repeat2 size={14} /> 4
            </span>
            <span className="inline-flex items-center gap-1">
              <Heart size={14} /> 38
            </span>
            <span className="inline-flex items-center gap-1">
              <Share2 size={14} /> 1
            </span>
          </div>
        </div>
        <button type="button" className="text-slate-400 hover:text-slate-600" aria-label="More">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  );
}

function SocialPreviewCard({ platform, caption, imageUrl }: { platform: string; caption: string; imageUrl: string }) {
  const normalized = String(platform || '').trim().toLowerCase();
  if (normalized === 'instagram' || normalized === 'threads') {
    return <InstagramPreviewCard platform={normalized} caption={caption} imageUrl={imageUrl} />;
  }
  if (normalized === 'facebook' || normalized === 'linkedin') {
    return <FacebookPreviewCard platform={normalized} caption={caption} imageUrl={imageUrl} />;
  }
  if (normalized === 'twitter' || normalized === 'x') {
    return <TwitterPreviewCard caption={caption} imageUrl={imageUrl} />;
  }
  // Fallback to a clean, platform-neutral card.
  return <FacebookPreviewCard platform={normalized || 'facebook'} caption={caption} imageUrl={imageUrl} />;
}

export default function SocialTemplatePreview({
  platform,
  settings,
}: {
  platform: string;
  settings: SocialTemplateSettings;
}) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [selectedPostId, setSelectedPostId] = useState<string>('');
  const [preview, setPreview] = useState<SocialTemplatePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewPosts = useMemo(() => posts.slice(0, 10), [posts]);
  const network = useMemo(() => getNetworkConfig(platform), [platform]);

  useEffect(() => {
    let canceled = false;
    setLoadingPosts(true);
    setError(null);

    blogService
      .listPosts()
      .then((result) => {
        if (canceled) return;
        setPosts(result || []);
      })
      .catch((e: any) => {
        if (canceled) return;
        setError(e?.message || 'Failed to load posts');
      })
      .finally(() => {
        if (canceled) return;
        setLoadingPosts(false);
      });

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPostId && previewPosts.length > 0) {
      setSelectedPostId(previewPosts[0].id);
    }
  }, [previewPosts, selectedPostId]);

  const runPreview = async () => {
    if (!selectedPostId) return;
    setPreviewLoading(true);
    setError(null);
    try {
      const result = await socialTemplateService.previewTemplate(platform, selectedPostId, settings);
      setPreview(result);
    } catch (e: any) {
      setError(e?.message || 'Failed to generate preview');
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {loadingPosts ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 size={14} className="animate-spin" /> Loading posts…
        </div>
      ) : null}

      {!loadingPosts && previewPosts.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          No posts found yet. Create a post to preview your template.
        </div>
      ) : null}

      {!loadingPosts && previewPosts.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={selectedPostId}
            onChange={(e) => setSelectedPostId(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
          >
            {previewPosts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.title || post.id}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={runPreview}
            disabled={previewLoading || !selectedPostId}
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {previewLoading ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" /> Generating…
              </>
            ) : (
              'Preview'
            )}
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {preview.warning ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-500" />
              )}
              <span>
                {preview.characterCount} / {preview.limit} characters
              </span>
              {network ? (
                <span className="text-xs font-semibold text-slate-400">
                  • {network.label} preview
                </span>
              ) : null}
            </div>
            {preview.truncated ? (
              <div className="text-xs font-semibold text-red-600">
                Truncated from {preview.originalCharacterCount} characters
              </div>
            ) : null}
          </div>

          {preview.warning ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
              {preview.warning}
            </div>
          ) : null}

          <SocialPreviewCard platform={platform} caption={preview.rendered} imageUrl={preview.featuredImage || ''} />
        </div>
      ) : null}
    </div>
  );
}

