import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Copy,
  FileText,
  Tag,
  FolderOpen,
  Loader2,
  Check,
  X,
  Clock,
  Save,
  Sparkles,
  Calendar as CalendarIcon,
  CheckCircle2,
  XCircle,
  Settings,
} from 'lucide-react';
import { blogService, type BlogCategory, type BlogPost, type BlogPostPayload, type BlogTag } from '../services/blogService';
import type { AppUser } from '../utils/userSession';
import SeoScoreBadge from '../components/SeoScoreBadge';
import RichTextEditor from '../components/RichTextEditor';
import Automation from './Automation';
import Calendar from './Calendar';

type PostsView = 'posts' | 'editor' | 'categories' | 'tags' | 'calendar' | 'automation';

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ');

const normalizeText = (value: string) => stripHtml(value).replace(/\s+/g, ' ').trim();

const countWords = (value: string) => {
  const text = normalizeText(value);
  if (!text) return 0;
  return text.split(' ').length;
};

const countSentences = (value: string) => {
  const text = normalizeText(value);
  if (!text) return 0;
  return text.split(/[.!?]+/).filter(Boolean).length;
};

const countParagraphs = (value: string) => {
  const fromHtml = (value.match(/<p[\s>]/gi) || []).length;
  if (fromHtml > 0) return fromHtml;
  const text = normalizeText(value);
  return text ? text.split(/\n{2,}/).filter(Boolean).length : 0;
};

const extractKeywords = (value: string, limit = 5) => {
  const stopwords = new Set([
    'the',
    'and',
    'for',
    'with',
    'this',
    'that',
    'from',
    'your',
    'you',
    'are',
    'was',
    'were',
    'have',
    'has',
    'had',
    'into',
    'about',
    'over',
    'under',
    'more',
    'less',
    'than',
    'then',
    'also',
    'just',
    'they',
    'their',
    'them',
    'our',
    'out',
    'can',
    'will',
    'not',
    'but',
    'how',
    'what',
    'why',
    'when',
    'where',
    'who',
    'which',
  ]);
  const words = normalizeText(value)
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9-]/g, ''))
    .filter((word) => word.length > 3 && !stopwords.has(word));
  const counts = new Map<string, number>();
  words.forEach((word) => counts.set(word, (counts.get(word) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, limit);
};

type SeoCheck = {
  id: string;
  label: string;
  pass: boolean;
  points: number;
};

type SeoSection = {
  id: string;
  title: string;
  checks: SeoCheck[];
  status: string;
};

const buildSeoAnalysis = ({
  title,
  slug,
  content,
  seoTitle,
  seoDescription,
  focusKeywords,
}: {
  title: string;
  slug: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  focusKeywords: string[];
}) => {
  const keywordList = focusKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
  const hasKeyword = (value: string) => keywordList.some((k) => value.includes(k));

  const contentText = normalizeText(content);
  const contentLower = contentText.toLowerCase();
  const titleLower = title.toLowerCase();
  const slugLower = slug.toLowerCase();
  const wordCount = countWords(content);
  const sentenceCount = countSentences(content);
  const avgSentenceLength = sentenceCount > 0 ? wordCount / sentenceCount : 0;
  const paragraphCount = countParagraphs(content);
  const hasHeadings = /<h[23][\s>]/i.test(content);
  const hasList = /<ul[\s>]|<ol[\s>]/i.test(content);
  const hasLink = /https?:\/\//i.test(content) || /<a[\s>]/i.test(content);

  const sections: Omit<SeoSection, 'status'>[] = [
    {
      id: 'basic',
      title: 'Basic SEO',
      checks: [
        { id: 'seo-title', label: 'SEO title is set', pass: seoTitle.trim().length > 0, points: 10 },
        { id: 'seo-description', label: 'SEO description is set', pass: seoDescription.trim().length > 0, points: 10 },
        { id: 'focus-keyword', label: 'Focus keyword is set', pass: keywordList.length > 0, points: 10 },
        {
          id: 'keyword-in-content',
          label: 'Focus keyword appears in content',
          pass: keywordList.length > 0 && hasKeyword(contentLower),
          points: 10,
        },
      ],
    },
    {
      id: 'additional',
      title: 'Additional SEO',
      checks: [
        {
          id: 'keyword-in-slug',
          label: 'Slug contains focus keyword',
          pass: keywordList.length > 0 && hasKeyword(slugLower),
          points: 10,
        },
        {
          id: 'content-length',
          label: 'Content length is at least 300 words',
          pass: wordCount >= 300,
          points: 10,
        },
        {
          id: 'link-present',
          label: 'Includes at least one link',
          pass: hasLink,
          points: 10,
        },
      ],
    },
    {
      id: 'title-readability',
      title: 'Title Readability',
      checks: [
        {
          id: 'title-length',
          label: 'Title length is 40-60 characters',
          pass: title.length >= 40 && title.length <= 60,
          points: 10,
        },
        {
          id: 'title-keyword',
          label: 'Title includes focus keyword',
          pass: keywordList.length > 0 && hasKeyword(titleLower),
          points: 5,
        },
      ],
    },
    {
      id: 'content-readability',
      title: 'Content Readability',
      checks: [
        {
          id: 'sentence-length',
          label: 'Average sentence length under 25 words',
          pass: sentenceCount > 0 && avgSentenceLength <= 25,
          points: 5,
        },
        {
          id: 'headings',
          label: 'Uses headings (H2/H3)',
          pass: hasHeadings,
          points: 5,
        },
        {
          id: 'lists',
          label: 'Uses bullet or numbered lists',
          pass: hasList,
          points: 5,
        },
      ],
    },
  ];

  const totalPoints = sections.reduce((sum, section) => sum + section.checks.reduce((s, check) => s + check.points, 0), 0);
  const earnedPoints = sections.reduce(
    (sum, section) => sum + section.checks.reduce((s, check) => s + (check.pass ? check.points : 0), 0),
    0
  );

  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const sectionsWithStatus: SeoSection[] = sections.map((section) => {
    const failed = section.checks.filter((check) => !check.pass).length;
    const status = failed === 0 ? 'All Good' : failed === 1 ? '1 Error' : 'Multiple Errors';
    return { ...section, status };
  });

  return {
    score,
    sections: sectionsWithStatus,
    wordCount,
    paragraphCount,
    avgSentenceLength,
    contentText,
  };
};

function CategoriesTab({ categories, onChange }: { categories: BlogCategory[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      await blogService.createCategory(n);
      setName('');
      onChange();
    } finally {
      setCreating(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await blogService.deleteCategory(id);
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Create category</div>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            placeholder="Category name..."
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || !name.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Categories</div>
        <div className="mt-3 space-y-2">
          {categories.length === 0 ? (
            <div className="text-sm text-slate-400">No categories yet.</div>
          ) : (
            categories.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.slug}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void del(c.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TagsTab({ tags, onChange }: { tags: BlogTag[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      await blogService.createTag(n);
      setName('');
      onChange();
    } finally {
      setCreating(false);
    }
  };

  const del = async (id: string) => {
    if (!confirm('Delete this tag?')) return;
    await blogService.deleteTag(id);
    onChange();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Create tag</div>
        <div className="mt-3 flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
            placeholder="Tag name..."
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={creating || !name.trim()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Add
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-bold text-slate-900">Tags</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {tags.length === 0 ? (
            <div className="text-sm text-slate-400">No tags yet.</div>
          ) : (
            tags.map((t) => (
              <div key={t.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
                <Tag size={11} className="text-slate-400" />
                {t.name}
                <button type="button" onClick={() => void del(t.id)} className="ml-1 text-slate-400 hover:text-red-600" title="Delete">
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function PostsList({ onEdit, onNew }: { onEdit: (id: string) => void; onNew: () => void }) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'scheduled'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await blogService.listPosts({ status: statusFilter, search });
      setPosts(data);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    await blogService.deletePost(id);
    setPosts((p) => p.filter((post) => post.id !== id));
  };

  const handleDuplicate = async (id: string) => {
    const copy = await blogService.duplicatePost(id);
    setPosts((p) => [copy, ...p]);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts..."
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
        >
          <option value="all">All</option>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="scheduled">Scheduled</option>
        </select>
        <button
          type="button"
          onClick={onNew}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
        >
          <Plus size={16} /> Add Post
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <div className="grid grid-cols-[1fr_auto] gap-3 items-center px-4 py-3 border-b border-slate-100 text-xs font-bold text-slate-500">
          <span>Title</span>
          <span className="text-right">Actions</span>
        </div>
        <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
          {loading ? (
            <div className="px-4 py-8 text-center text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin inline-block mr-2 text-slate-400" />
              Loading...
            </div>
          ) : posts.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-slate-500">No posts found.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {posts.map((post) => (
                <div key={post.id} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[post.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {post.status}
                      </span>
                      <span className="text-xs text-slate-400">Updated {fmtDate(post.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => onEdit(post.id)} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <Pencil size={14} />
                    </button>
                    <button type="button" onClick={() => void handleDuplicate(post.id)} title="Duplicate" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                      <Copy size={14} />
                    </button>
                    <button type="button" onClick={() => void handleDelete(post.id)} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PostEditor({
  postId,
  categories,
  tags,
  onSaved,
  onBack,
}: {
  postId: string | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  onSaved: (post: BlogPost) => void;
  onBack: () => void;
}) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [content, setContent] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [featuredImageName, setFeaturedImageName] = useState<string | null>(null);
  const [status, setStatus] = useState<'draft' | 'published' | 'scheduled'>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [focusKeywords, setFocusKeywords] = useState<string[]>([]);
  const [focusKeywordInput, setFocusKeywordInput] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'post' | 'seo'>('post');
  const [createTab, setCreateTab] = useState<'editor' | 'automation'>('editor');
  const [automationSettings, setAutomationSettings] = useState({
    autoSeoScan: true,
    autoInternalLinks: false,
    scheduleAuditAt: '',
  });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!postId) return;
    setLoading(true);
    blogService
      .getPost(postId)
      .then((post) => {
        setTitle(post.title || '');
        setSlug(post.slug || '');
        setSlugEdited(true);
        setContent(post.content || '');
        setExcerpt(post.excerpt || '');
        setFeaturedImage(post.featured_image || '');
        setFeaturedImageName(null);
        setStatus(post.status);
        setScheduledAt(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '');
        setCategoryId(post.category_id ?? '');
        setSelectedTagIds(post.tag_ids ?? []);
        setSeoTitle(post.meta_title || '');
        setSeoDescription(post.meta_description || '');
        setFocusKeywords(
          post.focus_keyword ? post.focus_keyword.split(',').map((k) => k.trim()).filter(Boolean) : []
        );
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false));
  }, [postId]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addFocusKeywords = (raw: string) => {
    const next = raw
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    setFocusKeywords((prev) => Array.from(new Set([...prev, ...next])));
  };

  const removeFocusKeyword = (keyword: string) => {
    setFocusKeywords((prev) => prev.filter((k) => k !== keyword));
  };

  const handleFeaturedImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFeaturedImageName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setFeaturedImage(String(reader.result || ''));
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const clearFeaturedImage = () => {
    setFeaturedImage('');
    setFeaturedImageName(null);
  };

  const updateAutomationSettings = (patch: Partial<typeof automationSettings>) => {
    setAutomationSettings((prev) => ({ ...prev, ...patch }));
  };

  const seo = useMemo(
    () =>
      buildSeoAnalysis({
        title,
        slug,
        content,
        seoTitle,
        seoDescription,
        focusKeywords,
      }),
    [title, slug, content, seoTitle, seoDescription, focusKeywords]
  );

  const suggestedSeoTitle = title.trim() ? title.trim().slice(0, 60) : '';
  const suggestedSeoDescription = seo.contentText ? seo.contentText.slice(0, 155) : '';
  const suggestedKeywords = extractKeywords(`${title} ${seo.contentText}`, 3);

  const save = async (nextStatus?: 'draft' | 'published' | 'scheduled') => {
    setSaving(true);
    setError(null);
    try {
      const finalStatus = nextStatus ?? status;
      const payload: BlogPostPayload = {
        title,
        slug,
        content,
        excerpt,
        featured_image: featuredImage,
        status: finalStatus,
        scheduled_at: finalStatus === 'scheduled' ? scheduledAt : null,
        category_id: categoryId || null,
        tag_ids: selectedTagIds,
        meta_title: seoTitle,
        meta_description: seoDescription,
        focus_keyword: focusKeywords.join(', '),
        social_automation: automationSettings,
      };
      const saved = postId ? await blogService.updatePost(postId, payload) : await blogService.createPost(payload);
      onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

    return (
    <div className={loading ? 'opacity-60 pointer-events-none' : ''}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <button type="button" onClick={onBack} className="text-sm font-semibold text-slate-600 hover:text-slate-900">
            Back to Posts
          </button>
          <div className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Post / Create Post</div>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{postId ? 'Edit Post' : 'Create Post'}</h2>
          <p className="mt-1 text-sm text-slate-500">Write, optimize, and automate your post in one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save('draft')}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save draft
          </button>
          <button
            type="button"
            onClick={() => void save('published')}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            Publish
          </button>
        </div>
      </div>

      {error && <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="mt-4">
        <div className="flex items-center gap-2 border-b border-slate-200">
          <button
            type="button"
            onClick={() => setCreateTab('editor')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              createTab === 'editor' ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {postId ? 'Edit Post' : 'Create Post'}
          </button>
          <button
            type="button"
            onClick={() => setCreateTab('automation')}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
              createTab === 'automation' ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Automation
          </button>
        </div>
      </div>

      {createTab === 'automation' ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white">
                  <Sparkles size={18} />
                </div>
                <div>
                  <div className="text-sm font-bold text-slate-900">Automation</div>
                  <div className="text-xs text-slate-500">AI-assisted suggestions and scheduled actions.</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-600">SEO Title Suggestion</div>
                  <div className="text-sm text-slate-700">{suggestedSeoTitle || 'Add a post title to get a suggestion.'}</div>
                  <button
                    type="button"
                    onClick={() => suggestedSeoTitle && setSeoTitle(suggestedSeoTitle)}
                    disabled={!suggestedSeoTitle}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Use suggestion
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-600">SEO Description Suggestion</div>
                  <div className="text-sm text-slate-700">{suggestedSeoDescription || 'Write some content to generate a meta description.'}</div>
                  <button
                    type="button"
                    onClick={() => suggestedSeoDescription && setSeoDescription(suggestedSeoDescription)}
                    disabled={!suggestedSeoDescription}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Use suggestion
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-600">Focus Keyword Suggestions</div>
                  <div className="flex flex-wrap gap-2">
                    {suggestedKeywords.length === 0 ? (
                      <span className="text-xs text-slate-500">Add content to see keyword ideas.</span>
                    ) : (
                      suggestedKeywords.map((kw) => (
                        <button
                          key={kw}
                          type="button"
                          onClick={() => addFocusKeywords(kw)}
                          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                        >
                          {kw}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                  <div className="text-xs font-semibold text-slate-600">Content Improvements</div>
                  <div className="text-sm text-slate-700">Focus on shortening long sentences and adding headings or lists for better readability.</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-semibold text-slate-600">Scheduled Actions</div>
                <div className="mt-3 space-y-2 text-xs text-slate-600">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={automationSettings.autoSeoScan}
                      onChange={(e) => updateAutomationSettings({ autoSeoScan: e.target.checked })}
                    />
                    Run SEO scan on every save
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={automationSettings.autoInternalLinks}
                      onChange={(e) => updateAutomationSettings({ autoInternalLinks: e.target.checked })}
                    />
                    Suggest internal links before publish
                  </label>
                </div>
                <div className="mt-3">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5">Schedule audit</label>
                  <input
                    type="datetime-local"
                    value={automationSettings.scheduleAuditAt}
                    onChange={(e) => updateAutomationSettings({ scheduleAuditAt: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-center">
              <div className="text-sm font-bold text-slate-900">Current SEO Score</div>
              <div className="mt-4 flex items-center justify-center">
                <SeoScoreBadge score={seo.score} />
              </div>
              <p className="mt-3 text-xs text-slate-500">Switch back to Create Post to adjust SEO fields.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Post Title</label>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (!slugEdited) setSlug(slugify(e.target.value));
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                placeholder="Enter post title..."
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>{title.length} characters</span>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">/{slug || 'your-slug'}</span>
              </div>
              <label className="mt-4 block text-xs font-semibold text-slate-500 mb-1.5">Slug</label>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(slugify(e.target.value));
                }}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
              />
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Content</label>
              <RichTextEditor value={content} onChange={setContent} />
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500">
                <span>{seo.wordCount} words</span>
                <span>{seo.contentText.length} characters</span>
                <span>{seo.paragraphCount || 0} paragraphs</span>
                <span>Avg. sentence length: {seo.avgSentenceLength ? Math.round(seo.avgSentenceLength) : 0} words</span>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                <button
                  type="button"
                  onClick={() => setSidebarTab('post')}
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                    sidebarTab === 'post' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Post
                </button>
                <button
                  type="button"
                  onClick={() => setSidebarTab('seo')}
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.2em] ${
                    sidebarTab === 'seo' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  SEO
                </button>
              </div>

              {sidebarTab === 'post' ? (
                <div className="pt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Featured Image</label>
                    <div className="space-y-2">
                      {featuredImage ? (
                        <img src={featuredImage} alt="Featured" className="h-40 w-full rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-xs text-slate-400">
                          Upload or paste an image URL
                        </div>
                      )}
                      {featuredImageName && <div className="text-xs text-slate-500">Uploaded: {featuredImageName}</div>}
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
                          Upload
                          <input type="file" accept="image/*" className="hidden" onChange={handleFeaturedImageUpload} />
                        </label>
                        {featuredImage && (
                          <button
                            type="button"
                            onClick={clearFeaturedImage}
                            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <input
                        value={featuredImage}
                        onChange={(e) => {
                          setFeaturedImageName(null);
                          setFeaturedImage(e.target.value);
                        }}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-xs outline-none focus:border-slate-400"
                        placeholder="Paste image URL..."
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                    >
                      <option value="draft">Draft</option>
                      <option value="published">Published</option>
                      <option value="scheduled">Scheduled</option>
                    </select>
                  </div>

                  {status === 'scheduled' && (
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1.5">Schedule date/time</label>
                      <div className="relative">
                        <Clock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="datetime-local"
                          value={scheduledAt}
                          onChange={(e) => setScheduledAt(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Category</label>
                    <select
                      value={categoryId || ''}
                      onChange={(e) => setCategoryId(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                    >
                      <option value="">-</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Tags</label>
                    <div className="flex flex-wrap gap-2">
                      {tags.length === 0 ? (
                        <div className="text-xs text-slate-400">No tags yet.</div>
                      ) : (
                        tags.map((t) => {
                          const active = selectedTagIds.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => toggleTag(t.id)}
                              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                active ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {active && <Check size={12} />}
                              {t.name}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Excerpt</label>
                    <textarea
                      rows={3}
                      value={excerpt}
                      onChange={(e) => setExcerpt(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                    />
                  </div>
                </div>
              ) : (
                <div className="pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <SeoScoreBadge score={seo.score} />
                    <div className="text-xs text-slate-500">Live score</div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">SEO Title</label>
                    <input
                      value={seoTitle}
                      onChange={(e) => setSeoTitle(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      placeholder="SEO title..."
                    />
                    <div className="mt-1 text-xs text-slate-500">{seoTitle.length} characters</div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">SEO Description</label>
                    <textarea
                      rows={3}
                      value={seoDescription}
                      onChange={(e) => setSeoDescription(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                      placeholder="SEO description..."
                    />
                    <div className="mt-1 text-xs text-slate-500">{seoDescription.length} characters</div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5">Focus Keywords</label>
                    <div className="flex flex-wrap gap-2">
                      {focusKeywords.length === 0 ? (
                        <div className="text-xs text-slate-400">Add focus keywords</div>
                      ) : (
                        focusKeywords.map((keyword) => (
                          <span key={keyword} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                            {keyword}
                            <button type="button" onClick={() => removeFocusKeyword(keyword)} className="text-slate-400 hover:text-slate-700">
                              <X size={12} />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        value={focusKeywordInput}
                        onChange={(e) => setFocusKeywordInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',') {
                            e.preventDefault();
                            addFocusKeywords(focusKeywordInput);
                            setFocusKeywordInput('');
                          }
                        }}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs outline-none focus:border-slate-400"
                        placeholder="Add keywords and press Enter"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          addFocusKeywords(focusKeywordInput);
                          setFocusKeywordInput('');
                        }}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {seo.sections.map((section) => (
                      <div key={section.id} className="rounded-xl border border-slate-200 bg-white p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-slate-700">{section.title}</div>
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                              section.status === 'All Good'
                                ? 'bg-emerald-100 text-emerald-700'
                                : section.status === '1 Error'
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {section.status}
                          </span>
                        </div>
                        <div className="mt-2 space-y-2">
                          {section.checks.map((check) => (
                            <div key={check.id} className="flex items-start gap-2 text-xs text-slate-600">
                              {check.pass ? (
                                <CheckCircle2 size={14} className="text-emerald-500 mt-0.5" />
                              ) : (
                                <XCircle size={14} className="text-red-400 mt-0.5" />
                              )}
                              <span>{check.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Posts({ currentUser }: { currentUser: AppUser | null }) {
  const [view, setView] = useState<PostsView>('posts');
  const [editPostId, setEditPostId] = useState<string | null>(null);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);

  const loadMeta = useCallback(async () => {
    const [cats, tgs] = await Promise.all([blogService.listCategories(), blogService.listTags()]);
    setCategories(cats);
    setTags(tgs);
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const openEditor = (id: string | null) => {
    setEditPostId(id);
    setView('editor');
  };

  const NAV_TABS: { id: PostsView; label: string; icon: React.ElementType }[] = useMemo(
    () => [
      { id: 'posts', label: 'All Posts', icon: FileText },
      { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
      { id: 'automation', label: 'Post Automation', icon: Settings },
      { id: 'categories', label: 'Categories', icon: FolderOpen },
      { id: 'tags', label: 'Tags', icon: Tag },
    ],
    []
  );

  return (
    <div className="space-y-6 pb-8">
      {view !== 'editor' && (
        <div>
          <div className="flex items-start justify-between mb-1">
            <div>
              <h1 className="text-4xl font-black tracking-[-0.04em] text-slate-950">Posts</h1>
              <p className="mt-2 text-base text-slate-500">Create, manage, and publish your blog content.</p>
            </div>
            {view === 'posts' && (
              <button type="button" onClick={() => openEditor(null)} className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 shrink-0">
                <Plus size={16} /> Add Post
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 border-b border-slate-200 mt-6">
            {NAV_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                  view === id ? 'border-slate-950 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'posts' && <PostsList onEdit={(id) => openEditor(id)} onNew={() => openEditor(null)} />}
      {view === 'calendar' && <Calendar onEditPost={(id: string | null) => openEditor(id)} />}
      {view === 'automation' && <Automation />}
      {view === 'categories' && <CategoriesTab categories={categories} onChange={() => void loadMeta()} />}
      {view === 'tags' && <TagsTab tags={tags} onChange={() => void loadMeta()} />}

      {view === 'editor' && (
        <PostEditor
          postId={editPostId}
          categories={categories}
          tags={tags}
          onSaved={() => {
            setView('posts');
            setEditPostId(null);
          }}
          onBack={() => {
            setView('posts');
            setEditPostId(null);
          }}
        />
      )}

      <div className="hidden">{currentUser?.id}</div>
    </div>
  );
}


