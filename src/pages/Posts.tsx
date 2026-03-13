import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, Pencil, Trash2, Copy, FileText, Tag, FolderOpen, Loader2, Check, X, Clock, Save } from 'lucide-react';
import { blogService, type BlogCategory, type BlogPost, type BlogPostPayload, type BlogTag } from '../services/blogService';
import type { AppUser } from '../utils/userSession';

type PostsView = 'posts' | 'editor' | 'categories' | 'tags';

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

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
  const [status, setStatus] = useState<'draft' | 'published' | 'scheduled'>('draft');
  const [scheduledAt, setScheduledAt] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
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
        setStatus(post.status);
        setScheduledAt(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '');
        setCategoryId(post.category_id ?? '');
        setSelectedTagIds(post.tag_ids ?? []);
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false));
  }, [postId]);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

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
            ← Back to Posts
          </button>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">{postId ? 'Edit Post' : 'New Post'}</h2>
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

      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Title</label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slugEdited) setSlug(slugify(e.target.value));
              }}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
              placeholder="Post title..."
            />
            <label className="mt-3 block text-xs font-semibold text-slate-500 mb-1.5">Slug</label>
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
            <textarea
              rows={14}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-slate-400"
              placeholder="Write your post..."
            />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400">
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
              <select value={categoryId || ''} onChange={(e) => setCategoryId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400">
                <option value="">—</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Excerpt</label>
              <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Featured image URL</label>
              <input value={featuredImage} onChange={(e) => setFeaturedImage(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" placeholder="https://..." />
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="text-sm font-bold text-slate-900">Tags</div>
            <div className="mt-3 flex flex-wrap gap-2">
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
        </div>
      </div>
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

      {view === 'posts' && <PostsList onEdit={(id) => openEditor(id)} onNew={() => openEditor(null)} />}
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
