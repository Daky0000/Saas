import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { blogService, type BlogPost } from '../../services/blogService';
import { socialTemplateService, type SocialTemplatePreview, type SocialTemplateSettings } from '../../services/socialTemplateService';

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
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              {preview.warning ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : (
                <CheckCircle2 size={16} className="text-emerald-500" />
              )}
              <span>
                {preview.characterCount} / {preview.limit} characters
              </span>
            </div>
            {preview.truncated ? (
              <div className="text-xs font-semibold text-red-600">
                Truncated from {preview.originalCharacterCount} characters
              </div>
            ) : null}
          </div>

          <pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-800">
            {preview.rendered}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

