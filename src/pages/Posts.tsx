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
  CheckCircle2,
  XCircle,
  MoreHorizontal,
} from 'lucide-react';
import { blogService, type BlogCategory, type BlogPost, type BlogPostPayload, type BlogTag } from '../services/blogService';
import { socialPostService, type SocialAccount } from '../services/socialPostService';
import { wordpressService, type WordPressStatus } from '../services/wordpressService';
import type { AppUser } from '../utils/userSession';
import SeoScoreBadge from '../components/SeoScoreBadge';
import RichTextEditor from '../components/RichTextEditor';
import { PlatformPreviewTabs } from '../components/posts/PlatformPreviewTabs';
import BulkActionsToolbar from '../components/posts/batch/BulkActionsToolbar';
import RescheduleModal from '../components/posts/batch/RescheduleModal';
import TagModal from '../components/posts/batch/TagModal';
import DeleteConfirmModal from '../components/posts/batch/DeleteConfirmModal';
import PlatformsModal from '../components/posts/batch/PlatformsModal';
import { useBatchActions } from '../hooks/useBatchActions';

type PostsView = 'posts' | 'editor' | 'categories' | 'tags';

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
  archived: 'bg-amber-100 text-amber-700',
  deleted: 'bg-rose-100 text-rose-700',
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

function PostsList({
  onEdit,
  onNew,
  tags,
  onTagsRefresh,
}: {
  onEdit: (id: string) => void;
  onNew: () => void;
  tags: BlogTag[];
  onTagsRefresh: () => void;
}) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'published' | 'scheduled' | 'archived'>('all');
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);
  const [selectedPostIds, setSelectedPostIds] = useState<Set<string>>(new Set());
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [showTagModal, setShowTagModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showPlatformsModal, setShowPlatformsModal] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);

  const { recordUndo, undo, canUndo } = useBatchActions();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await blogService.listPosts({ status: statusFilter, search });
      setPosts(data);
      setSelectedPostIds((prev) => {
        if (prev.size === 0) return prev;
        const keep = new Set(data.map((post) => post.id));
        return new Set([...prev].filter((id) => keep.has(id)));
      });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleClickOutside = () => setDropdownOpen(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    await blogService.batchDelete([id]);
    setPosts((p) => p.filter((post) => post.id !== id));
    setSelectedPostIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const handleDuplicate = async (id: string) => {
    const copy = await blogService.duplicatePost(id);
    setPosts((p) => [copy, ...p]);
  };

  const handleReschedule = async (id: string) => {
    const newDate = prompt('Enter new schedule date/time (YYYY-MM-DDTHH:MM):');
    if (!newDate) return;
    try {
      await blogService.updatePost(id, { scheduled_at: newDate });
      setPosts((p) => p.map((post) => (post.id === id ? { ...post, scheduled_at: newDate } : post)));
      setDropdownOpen(null);
    } catch (error) {
      alert('Failed to reschedule post');
    }
  };

  const handleRepublish = async (id: string) => {
    if (!confirm('Republish this post to connected social accounts?')) return;
    try {
      // For now, we'll just show a message since republish endpoint needs implementation
      alert(`Republish functionality for post ${id} will be implemented soon`);
      setDropdownOpen(null);
    } catch (error) {
      alert('Failed to republish post');
    }
  };

  const selectedPosts = useMemo(() => posts.filter((post) => selectedPostIds.has(post.id)), [posts, selectedPostIds]);

  const toggleSelectPost = (id: string) => {
    setSelectedPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedPostIds.size === posts.length) {
      setSelectedPostIds(new Set());
      return;
    }
    setSelectedPostIds(new Set(posts.map((post) => post.id)));
  };

  const handleClearSelection = () => setSelectedPostIds(new Set());

  const handleRescheduleSubmit = async (date: string, time: string) => {
    const scheduledAt = new Date(`${date}T${time}`);
    if (Number.isNaN(scheduledAt.getTime())) {
      alert('Invalid date/time');
      return;
    }
    setProcessing(true);
    try {
      const previousState = JSON.parse(JSON.stringify(selectedPosts)) as BlogPost[];
      recordUndo('reschedule', Array.from(selectedPostIds), previousState);
      const result = await blogService.batchReschedule(Array.from(selectedPostIds), scheduledAt.toISOString());
      setMessage(`Rescheduled ${result.updated} posts.`);
      setShowRescheduleModal(false);
      await load();
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to reschedule posts');
    } finally {
      setProcessing(false);
    }
  };

  const handleTagSubmit = async (tagIds: string[]) => {
    setProcessing(true);
    try {
      const previousState = JSON.parse(JSON.stringify(selectedPosts)) as BlogPost[];
      recordUndo('tag', Array.from(selectedPostIds), previousState);
      const result = await blogService.batchTag(Array.from(selectedPostIds), tagIds);
      setMessage(`Tagged ${result.updated} posts.`);
      setShowTagModal(false);
      await load();
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to tag posts');
    } finally {
      setProcessing(false);
    }
  };

  const handleArchive = async () => {
    if (selectedPostIds.size === 0) return;
    setProcessing(true);
    try {
      const previousState = JSON.parse(JSON.stringify(selectedPosts)) as BlogPost[];
      recordUndo('archive', Array.from(selectedPostIds), previousState);
      const result = await blogService.batchArchive(Array.from(selectedPostIds));
      setMessage(`Archived ${result.updated} posts.`);
      await load();
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to archive posts');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (selectedPostIds.size === 0) return;
    setProcessing(true);
    try {
      const previousState = JSON.parse(JSON.stringify(selectedPosts)) as BlogPost[];
      recordUndo('delete', Array.from(selectedPostIds), previousState);
      const result = await blogService.batchDelete(Array.from(selectedPostIds));
      setMessage(`Deleted ${result.updated} posts.`);
      setShowDeleteModal(false);
      await load();
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to delete posts');
    } finally {
      setProcessing(false);
    }
  };

  const handleDuplicateBatch = async () => {
    if (selectedPostIds.size === 0) return;
    setProcessing(true);
    try {
      const result = await blogService.batchDuplicate(Array.from(selectedPostIds));
      setMessage(`Duplicated ${result.created} posts.`);
      await load();
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to duplicate posts');
    } finally {
      setProcessing(false);
    }
  };

  const handleExport = async () => {
    if (selectedPostIds.size === 0) return;
    setProcessing(true);
    try {
      const csv = await blogService.batchExport(Array.from(selectedPostIds));
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `posts-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage('Exported CSV.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to export posts');
    } finally {
      setProcessing(false);
    }
  };

  const ensureSocialAccounts = async () => {
    if (socialAccounts.length > 0) return;
    try {
      const accounts = await socialPostService.listAccounts();
      setSocialAccounts(accounts);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to load social accounts');
    }
  };

  const handlePlatformsSubmit = async (accountIds: string[]) => {
    if (selectedPostIds.size === 0) return;
    setProcessing(true);
    try {
      await blogService.batchUpdatePlatforms(Array.from(selectedPostIds), accountIds);
      setMessage(`Updated platforms for ${selectedPostIds.size} posts.`);
      setShowPlatformsModal(false);
      handleClearSelection();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to update platforms');
    } finally {
      setProcessing(false);
    }
  };

  const handleUndo = async () => {
    setProcessing(true);
    try {
      await undo();
      await load();
      setMessage('Undo complete.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to undo action');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className={`space-y-5 ${selectedPostIds.size > 0 ? 'pb-28' : ''}`}>
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
          <option value="archived">Archived</option>
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
        <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center px-4 py-3 border-b border-slate-100 text-xs font-bold text-slate-500">
          <input
            type="checkbox"
            checked={posts.length > 0 && selectedPostIds.size === posts.length}
            onChange={handleSelectAll}
            aria-label="Select all posts"
            className="h-4 w-4 rounded border-slate-300"
          />
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
              {posts.map((post) => {
                const isSelected = selectedPostIds.has(post.id);
                return (
                  <div
                    key={post.id}
                    className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 hover:bg-slate-50 ${isSelected ? 'bg-slate-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectPost(post.id)}
                      className="h-4 w-4 rounded border-slate-300"
                      data-testid="post-checkbox"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_BADGE[post.status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {post.status}
                        </span>
                        <span className="text-xs text-slate-400">Updated {fmtDate(post.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 relative">
                      <button type="button" onClick={() => onEdit(post.id)} title="Edit" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => void handleDuplicate(post.id)} title="Duplicate" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Copy size={14} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(post.id)} title="Delete" className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDropdownOpen(dropdownOpen === post.id ? null : post.id)}
                        title="More actions"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <MoreHorizontal size={14} />
                      </button>
                      {dropdownOpen === post.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                          <button
                            type="button"
                            onClick={() => void handleReschedule(post.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <Clock size={14} />
                            Reschedule Post
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRepublish(post.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                          >
                            <CheckCircle2 size={14} />
                            Republish
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedPostIds.size > 0 && (
        <div data-testid="batch-toolbar">
          <BulkActionsToolbar
            selectedCount={selectedPostIds.size}
            totalCount={posts.length}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onReschedule={() => setShowRescheduleModal(true)}
            onTag={() => setShowTagModal(true)}
            onPlatforms={() => {
              setShowPlatformsModal(true);
              void ensureSocialAccounts();
            }}
            onArchive={handleArchive}
            onDelete={() => setShowDeleteModal(true)}
            onDuplicate={handleDuplicateBatch}
            onExport={handleExport}
            onUndo={handleUndo}
            canUndo={canUndo}
            isLoading={processing}
            message={message}
          />
        </div>
      )}

      {showRescheduleModal && (
        <RescheduleModal
          count={selectedPostIds.size}
          onSubmit={handleRescheduleSubmit}
          onClose={() => setShowRescheduleModal(false)}
        />
      )}

      {showTagModal && (
        <TagModal
          count={selectedPostIds.size}
          tags={tags}
          onCreateTag={async (name) => {
            try {
              const created = await blogService.createTag(name);
              await onTagsRefresh();
              return created;
            } catch (error) {
              setMessage(error instanceof Error ? error.message : 'Failed to create tag');
              return null;
            }
          }}
          onSubmit={handleTagSubmit}
          onClose={() => setShowTagModal(false)}
        />
      )}

      {showDeleteModal && (
        <DeleteConfirmModal
          count={selectedPostIds.size}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      {showPlatformsModal && (
        <PlatformsModal
          count={selectedPostIds.size}
          accounts={socialAccounts}
          onSubmit={handlePlatformsSubmit}
          onClose={() => setShowPlatformsModal(false)}
        />
      )}
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
  const [status, setStatus] = useState<'draft' | 'published' | 'scheduled' | 'archived'>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [focusKeywords, setFocusKeywords] = useState<string[]>([]);
  const [focusKeywordInput, setFocusKeywordInput] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'post' | 'seo'>('post');
  const [createTab, setCreateTab] = useState<'editor' | 'automation'>('editor');
  const [socialAccounts, setSocialAccounts] = useState<SocialAccount[]>([]);
  const [wordpressStatus, setWordpressStatus] = useState<WordPressStatus | null>(null);
  const [selectedSocialAccounts, setSelectedSocialAccounts] = useState<string[]>([]);
  const [socialTemplate, setSocialTemplate] = useState('');
  const [socialPublishType, setSocialPublishType] = useState<'immediate' | 'scheduled' | 'delayed'>('immediate');
  const [socialScheduledAt, setSocialScheduledAt] = useState('');
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
        setStatus(post.status === 'deleted' ? 'draft' : post.status);
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

  useEffect(() => {
    socialPostService
      .listAccounts()
      .then(setSocialAccounts)
      .catch(() => {}); // Ignore errors for now

    wordpressService
      .getStatus()
      .then((status) => setWordpressStatus(status))
      .catch(() => {}); // Ignore errors for now
  }, []);

  useEffect(() => {
    if (!postId) return;
    socialPostService
      .getSettings(postId)
      .then((settings) => {
        if (settings) {
          setSocialTemplate(settings.template);
          setSocialPublishType(settings.publish_type);
          setSocialScheduledAt(settings.scheduled_at ? settings.scheduled_at.slice(0, 16) : '');
          setSelectedSocialAccounts(settings.accounts.map((acc) => acc.social_account_id));
        }
      })
      .catch(() => {}); // Ignore errors for now
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

  const selectedPlatforms = useMemo(() => {
    const selectedIds = new Set(selectedSocialAccounts);
    const normalizePlatform = (platform: string) => {
      const value = platform.toLowerCase();
      if (value.includes('instagram')) return 'instagram';
      if (value.includes('twitter') || value === 'x') return 'twitter';
      if (value.includes('linkedin')) return 'linkedin';
      if (value.includes('facebook')) return 'facebook';
      if (value.includes('tiktok')) return 'tiktok';
      return '';
    };

    const platforms = socialAccounts
      .filter((account) => selectedIds.has(account.id))
      .map((account) => normalizePlatform(account.platform))
      .filter(Boolean);

    return Array.from(new Set(platforms));
  }, [selectedSocialAccounts, socialAccounts]);

  const previewCaption = useMemo(() => {
    const template = socialTemplate.trim();
    if (template) return template;
    if (title.trim()) return title.trim();
    const fallback = excerpt.trim() ? excerpt : content;
    return normalizeText(fallback).slice(0, 500);
  }, [socialTemplate, title, excerpt, content]);

  const navigateToIntegrations = useCallback(() => {
    window.history.pushState({}, '', '/integrations');
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const primaryActionStatus: 'published' | 'scheduled' = status === 'scheduled' ? 'scheduled' : 'published';
  const primaryActionLabel = primaryActionStatus === 'scheduled' ? 'Schedule' : 'Publish';

  const save = async (nextStatus?: 'draft' | 'published' | 'scheduled') => {
    setSaving(true);
    setError(null);
    try {
      const finalStatus = nextStatus ?? status;
      if (finalStatus === 'scheduled' && !scheduledAt) {
        throw new Error('Choose a schedule date/time before scheduling this post.');
      }
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
      };
      const saved = postId ? await blogService.updatePost(postId, payload) : await blogService.createPost(payload);
      
      // Save social settings if we have a postId (after creation)
      const finalPostId = saved.id;
      if (selectedSocialAccounts.length > 0 || socialTemplate || socialPublishType !== 'immediate' || socialScheduledAt) {
        await socialPostService.saveSettings(finalPostId, {
          template: socialTemplate,
          publish_type: socialPublishType,
          scheduled_at: socialPublishType !== 'immediate' ? socialScheduledAt : null,
          accounts: selectedSocialAccounts,
        });
      }
      
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
            onClick={() => void save(primaryActionStatus)}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {primaryActionLabel}
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
        <div className="mt-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
    <div className="text-xs font-semibold text-slate-600 mb-3">Social Media Automation</div>
    <div className="space-y-4">
        
        <div>
            <div className="text-sm font-bold text-slate-800 mb-2">Wordpress</div>
            {wordpressStatus?.connected ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                        <span className="font-semibold capitalize">Wordpress</span>
                        <span className="text-slate-500">•</span>
                        <span>{wordpressStatus.siteUrl}</span>
                    </div>
                    <button
                        type="button"
                        className="text-red-500 hover:text-red-700 font-semibold"
                        onClick={() => alert('Disconnection logic to be implemented')}
                    >
                        Disconnect
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    onClick={navigateToIntegrations}
                >
                    Connect WordPress
                </button>
            )}
        </div>

        
        <div>
            <div className="text-sm font-bold text-slate-800 mb-2">Social Platforms</div>
            {socialAccounts.length > 0 ? (
                <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-2">Select accounts to auto-publish to:</label>
                    <div className="space-y-2 max-h-32 overflow-y-auto">
                        {socialAccounts.map((account) => (
                            <label key={account.id} className="flex items-center gap-2 text-xs">
                                <input
                                    type="checkbox"
                                    checked={selectedSocialAccounts.includes(account.id)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedSocialAccounts((prev) => [...prev, account.id]);
                                        } else {
                                            setSelectedSocialAccounts((prev) => prev.filter((id) => id !== account.id));
                                        }
                                    }}
                                    className="rounded border-slate-300"
                                />
                                <div className="flex items-center gap-2">
                                    {account.profile_image && <img src={account.profile_image} alt="" className="w-4 h-4 rounded-full" />}
                                    <span className="capitalize">{account.platform}</span>
                                    <span className="text-slate-500">•</span>
                                    <span>{account.account_name}</span>
                                </div>
                            </label>
                        ))}
                    </div>
                </div>
            ) : (
                 <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
                    onClick={navigateToIntegrations}
                >
                    Connect Social Platform Account
                </button>
            )}
        </div>

        
        {(wordpressStatus?.connected || socialAccounts.length > 0) && (
            <div className="pt-4 border-t border-slate-200">
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Social post template (optional)</label>
                <textarea
                    value={socialTemplate}
                    onChange={(e) => setSocialTemplate(e.target.value)}
                    placeholder="Custom message for social posts..."
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400 resize-none"
                    rows={2}
                />
                <div className="grid grid-cols-2 gap-2 mt-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1.5">Publish type</label>
                        <select
                            value={socialPublishType}
                            onChange={(e) => setSocialPublishType(e.target.value as 'immediate' | 'scheduled' | 'delayed')}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
                        >
                            <option value="immediate">Immediate</option>
                            <option value="scheduled">Scheduled</option>
                            <option value="delayed">Delayed</option>
                        </select>
                    </div>
                    {(socialPublishType === 'scheduled' || socialPublishType === 'delayed') && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Schedule time</label>
                            <input
                                type="datetime-local"
                                value={socialScheduledAt}
                                onChange={(e) => setSocialScheduledAt(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
                            />
                        </div>
                    )}
                </div>
                <div className="mt-4 pt-4 border-t border-slate-200">
                    <div className="text-xs font-semibold text-slate-600 mb-2">Multi-Platform Preview</div>
                    <PlatformPreviewTabs
                        caption={previewCaption}
                        selectedPlatforms={selectedPlatforms}
                        mediaUrls={featuredImage ? [featuredImage] : []}
                        onCaptionChange={setSocialTemplate}
                    />
                    {!socialTemplate.trim() && previewCaption && (
                        <div className="mt-2 text-[11px] text-slate-500">
                            Using your post title or excerpt for the preview. Add a social template to customize it.
                        </div>
                    )}
                </div>
            </div>
        )}

         {socialAccounts.length === 0 && !wordpressStatus?.connected && (
            <div className="text-xs text-slate-500 text-center py-4">
                No social accounts or WordPress site connected. Please connect one to get started.
            </div>
        )}
    </div>
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
                      <option value="archived">Archived</option>
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

      {view === 'posts' && (
        <PostsList
          onEdit={(id) => openEditor(id)}
          onNew={() => openEditor(null)}
          tags={tags}
          onTagsRefresh={() => void loadMeta()}
        />
      )}
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


