import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus, Search, Pencil, Trash2, Copy, FileText, Tag, FolderOpen,
  Bold, Italic, List, ListOrdered, Quote, Code, Image as ImageIcon,
  Heading1, Heading2, Heading3, Undo2, Redo2, Link,
  Loader2, Check, X, Save, Globe, Clock,
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapImage from '@tiptap/extension-image';
import { blogService, type BlogPost, type BlogCategory, type BlogTag, type BlogPostPayload } from '../services/blogService';
import MediaLibraryModal from '../components/media/MediaLibraryModal';

// ── Types ───────────────────────────────────────────────────────────────────────
type PostsView = 'posts' | 'editor' | 'categories' | 'tags';

const STATUS_LABELS: Record<string, string> = {
  all: 'All',
  draft: 'Draft',
  published: 'Published',
  scheduled: 'Scheduled',
};

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  published: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-blue-100 text-blue-700',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Blog Post Editor ─────────────────────────────────────────────────────────────
interface PostEditorProps {
  postId: string | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  onSaved: (post: BlogPost) => void;
  onBack: () => void;
}

function PostEditor({ postId, categories, tags, onSaved, onBack }: PostEditorProps) {
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [excerpt, setExcerpt] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [status, setStatus] = useState<'draft' | 'published' | 'scheduled'>('draft');
  const [categoryId, setCategoryId] = useState<string>('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [focusKeyword, setFocusKeyword] = useState('');
  const [socialTitle, setSocialTitle] = useState('');
  const [socialDescription, setSocialDescription] = useState('');
  const [socialImage, setSocialImage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaPurpose, setMediaPurpose] = useState<'featured' | 'social' | 'content'>('featured');
  const contentLoadedRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapImage.configure({ allowBase64: true }),
    ],
    content: '',
  });

  useEffect(() => {
    if (!postId || !editor) return;
    if (contentLoadedRef.current) return;
    setLoading(true);
    blogService.getPost(postId)
      .then((post) => {
        setTitle(post.title);
        setSlug(post.slug);
        setSlugEdited(true);
        setExcerpt(post.excerpt ?? '');
        setFeaturedImage(post.featured_image ?? '');
        setStatus(post.status);
        setCategoryId(post.category_id ?? '');
        setSelectedTagIds(post.tag_ids ?? []);
        setMetaTitle(post.meta_title ?? '');
        setMetaDescription(post.meta_description ?? '');
        setFocusKeyword(post.focus_keyword ?? '');
        setSocialTitle(post.social_title ?? '');
        setSocialDescription(post.social_description ?? '');
        setSocialImage(post.social_image ?? '');
        setScheduledAt(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '');
        editor.commands.setContent(post.content || '');
        contentLoadedRef.current = true;
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false));
  }, [postId, editor]);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slugEdited) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
    }
  };

  const handleSave = async (publishStatus?: 'draft' | 'published' | 'scheduled') => {
    const finalStatus = publishStatus ?? status;
    setSaving(true);
    setError(null);
    try {
      const payload: BlogPostPayload = {
        title, slug, content: editor?.getHTML() ?? '', excerpt, featured_image: featuredImage,
        status: finalStatus, category_id: categoryId || null,
        meta_title: metaTitle, meta_description: metaDescription, focus_keyword: focusKeyword,
        social_title: socialTitle, social_description: socialDescription, social_image: socialImage,
        scheduled_at: finalStatus === 'scheduled' ? scheduledAt : null,
        tag_ids: selectedTagIds,
      };
      const saved = postId
        ? await blogService.updatePost(postId, payload)
        : await blogService.createPost(payload);
      if (publishStatus) setStatus(publishStatus);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const openMedia = (purpose: 'featured' | 'social' | 'content') => {
    setMediaPurpose(purpose);
    setShowMediaPicker(true);
  };

  const handleMediaSelect = (url: string) => {
    setShowMediaPicker(false);
    if (mediaPurpose === 'featured') setFeaturedImage(url);
    else if (mediaPurpose === 'social') setSocialImage(url);
    else if (mediaPurpose === 'content') editor?.chain().focus().setImage({ src: url }).run();
  };

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-slate-400" size={28} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-900">
          ← Back to Posts
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void handleSave('draft')} disabled={saving}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Save size={15} />
            Save Draft
          </button>
          {status === 'scheduled'
            ? <button type="button" onClick={() => void handleSave('scheduled')} disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Clock size={15} />}
                Schedule
              </button>
            : <button type="button" onClick={() => void handleSave('published')} disabled={saving}
                className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Globe size={15} />}
                Publish
              </button>
          }
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        {/* Left: Editor */}
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Post title"
            value={title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-5 py-4 text-2xl font-bold text-slate-950 outline-none placeholder:text-slate-300 focus:border-slate-400"
          />
          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
            <span className="text-xs font-semibold text-slate-500">Slug</span>
            <input type="text" value={slug}
              onChange={(e) => { setSlug(e.target.value); setSlugEdited(true); }}
              className="flex-1 bg-transparent text-sm text-slate-700 outline-none" />
          </div>

          {/* WYSIWYG */}
          {editor && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 p-2">
                {([
                  { icon: Heading1, action: () => editor.chain().focus().toggleHeading({ level: 1 }).run(), active: editor.isActive('heading', { level: 1 }) },
                  { icon: Heading2, action: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: editor.isActive('heading', { level: 2 }) },
                  { icon: Heading3, action: () => editor.chain().focus().toggleHeading({ level: 3 }).run(), active: editor.isActive('heading', { level: 3 }) },
                ] as { icon: React.ElementType; action: () => void; active: boolean }[]).map(({ icon: Icon, action, active }, i) => (
                  <button key={i} type="button" onClick={action}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${active ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="mx-1 h-5 w-px bg-slate-200" />
                {([
                  { icon: Bold, action: () => editor.chain().focus().toggleBold().run(), active: editor.isActive('bold') },
                  { icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), active: editor.isActive('italic') },
                  { icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(), active: editor.isActive('blockquote') },
                  { icon: Code, action: () => editor.chain().focus().toggleCode().run(), active: editor.isActive('code') },
                ] as { icon: React.ElementType; action: () => void; active: boolean }[]).map(({ icon: Icon, action, active }, i) => (
                  <button key={i} type="button" onClick={action}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${active ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="mx-1 h-5 w-px bg-slate-200" />
                {([
                  { icon: List, action: () => editor.chain().focus().toggleBulletList().run(), active: editor.isActive('bulletList') },
                  { icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(), active: editor.isActive('orderedList') },
                ] as { icon: React.ElementType; action: () => void; active: boolean }[]).map(({ icon: Icon, action, active }, i) => (
                  <button key={i} type="button" onClick={action}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${active ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="mx-1 h-5 w-px bg-slate-200" />
                <button type="button" onClick={() => openMedia('content')}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100" title="Insert image">
                  <ImageIcon size={15} />
                </button>
                <button type="button" onClick={() => {
                  const url = prompt('Link URL');
                  if (url) editor.chain().focus().setLink({ href: url }).run();
                }}
                  className={`flex h-8 w-8 items-center justify-center rounded-lg transition ${editor.isActive('link') ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  <Link size={15} />
                </button>
                <div className="mx-1 h-5 w-px bg-slate-200" />
                <button type="button" onClick={() => editor.chain().focus().undo().run()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
                  <Undo2 size={15} />
                </button>
                <button type="button" onClick={() => editor.chain().focus().redo().run()}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100">
                  <Redo2 size={15} />
                </button>
              </div>
              <EditorContent
                editor={editor}
                className="min-h-[420px] px-6 py-5 prose prose-slate max-w-none text-sm leading-relaxed [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[400px]"
              />
            </div>
          )}

          {/* Excerpt */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Excerpt</label>
            <textarea rows={3} value={excerpt} onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Short description shown in listings..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none resize-none focus:border-slate-400" />
          </div>

          {/* SEO */}
          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700 select-none">SEO Settings</summary>
            <div className="space-y-4 px-5 pb-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">Meta Title</span>
                <input type="text" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="SEO title..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">Focus Keyword</span>
                <input type="text" value={focusKeyword} onChange={(e) => setFocusKeyword(e.target.value)} placeholder="Primary keyword..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">Meta Description</span>
                <textarea rows={2} value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="Page description for search engines..."
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:border-slate-400" />
              </label>
            </div>
          </details>

          {/* Social */}
          <details className="rounded-2xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-slate-700 select-none">Social Sharing</summary>
            <div className="space-y-4 px-5 pb-5">
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">Social Title</span>
                <input type="text" value={socialTitle} onChange={(e) => setSocialTitle(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-semibold text-slate-500">Social Description</span>
                <textarea rows={2} value={socialDescription} onChange={(e) => setSocialDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:border-slate-400" />
              </label>
              <div>
                <span className="text-xs font-semibold text-slate-500 block mb-1.5">Social Image</span>
                {socialImage
                  ? <div className="relative">
                      <img src={socialImage} alt="" className="h-24 w-full rounded-xl object-cover" />
                      <button type="button" onClick={() => openMedia('social')}
                        className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 text-white text-xs font-semibold opacity-0 hover:opacity-100">
                        Change
                      </button>
                    </div>
                  : <button type="button" onClick={() => openMedia('social')}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-3 text-sm text-slate-500 hover:border-slate-400">
                      <ImageIcon size={15} /> Set Social Image
                    </button>
                }
              </div>
            </div>
          </details>
        </div>

        {/* Right: Settings panel */}
        <div className="space-y-4">
          {/* Status + publish */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
            <h3 className="text-sm font-bold text-slate-900">Publish</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>
            {status === 'scheduled' && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">Publish Date & Time</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400" />
              </div>
            )}
          </div>

          {/* Featured Image */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Featured Image</h3>
            {featuredImage
              ? <div className="relative">
                  <img src={featuredImage} alt="" className="h-40 w-full rounded-xl object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex gap-2 p-2">
                    <button type="button" onClick={() => openMedia('featured')}
                      className="flex-1 rounded-lg bg-white/90 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white">
                      Change
                    </button>
                    <button type="button" onClick={() => setFeaturedImage('')}
                      className="rounded-lg bg-red-500/90 px-2 py-1.5 text-xs font-semibold text-white hover:bg-red-600">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              : <button type="button" onClick={() => openMedia('featured')}
                  className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-8 text-sm text-slate-500 hover:border-slate-400 hover:bg-slate-50">
                  <ImageIcon size={22} className="text-slate-300" />
                  Set featured image
                </button>
            }
          </div>

          {/* Category */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Category</h3>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400">
              <option value="">— No category —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-3">Tags</h3>
            {tags.length === 0
              ? <p className="text-xs text-slate-400">No tags yet. Create them in the Tags tab.</p>
              : <div className="flex flex-wrap gap-2">
                  {tags.map((t) => {
                    const active = selectedTagIds.includes(t.id);
                    return (
                      <button key={t.id} type="button" onClick={() => toggleTag(t.id)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                          active ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}>
                        {active && <Check size={11} />}
                        {t.name}
                      </button>
                    );
                  })}
                </div>
            }
          </div>
        </div>
      </div>

      {showMediaPicker && (
        <MediaLibraryModal
          onSelect={handleMediaSelect}
          onClose={() => setShowMediaPicker(false)}
        />
      )}
    </div>
  );
}

// ── Categories Tab ───────────────────────────────────────────────────────────────
interface CategoriesTabProps {
  categories: BlogCategory[];
  onChange: () => void;
}

function CategoriesTab({ categories, onChange }: CategoriesTabProps) {
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try { await blogService.createCategory(newName.trim()); setNewName(''); onChange(); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try { await blogService.updateCategory(id, editName.trim()); setEditId(null); onChange(); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this category?')) return;
    await blogService.deleteCategory(id);
    onChange();
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-950">Categories</h2>
        <p className="mt-1 text-sm text-slate-500">Organise posts into categories.</p>
      </div>
      <div className="flex gap-3">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          placeholder="New category name..."
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
        <button type="button" onClick={() => void handleCreate()} disabled={saving || !newName.trim()}
          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {categories.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No categories yet.</p>
        )}
        {categories.map((cat) => (
          <div key={cat.id} className="flex items-center gap-4 px-5 py-3">
            <FolderOpen size={16} className="text-slate-400 shrink-0" />
            {editId === cat.id
              ? <>
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleUpdate(cat.id); if (e.key === 'Escape') setEditId(null); }}
                    className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500"
                    autoFocus />
                  <button type="button" onClick={() => void handleUpdate(cat.id)} className="text-emerald-600 hover:text-emerald-700"><Check size={16} /></button>
                  <button type="button" onClick={() => setEditId(null)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </>
              : <>
                  <span className="flex-1 text-sm font-medium text-slate-800">{cat.name}</span>
                  <span className="text-xs text-slate-400">{cat.slug}</span>
                  <button type="button" onClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                    className="text-slate-400 hover:text-slate-700"><Pencil size={15} /></button>
                  <button type="button" onClick={() => void handleDelete(cat.id)}
                    className="text-slate-400 hover:text-red-600"><Trash2 size={15} /></button>
                </>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tags Tab ─────────────────────────────────────────────────────────────────────
interface TagsTabProps {
  tags: BlogTag[];
  onChange: () => void;
}

function TagsTab({ tags, onChange }: TagsTabProps) {
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try { await blogService.createTag(newName.trim()); setNewName(''); onChange(); }
    catch { /* ignore */ } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tag?')) return;
    await blogService.deleteTag(id);
    onChange();
  };

  const filtered = tags.filter((t) => !search || t.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-950">Tags</h2>
        <p className="mt-1 text-sm text-slate-500">Label posts with searchable tags.</p>
      </div>
      <div className="flex gap-3">
        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void handleCreate(); }}
          placeholder="New tag name..."
          className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-slate-400" />
        <button type="button" onClick={() => void handleCreate()} disabled={saving || !newName.trim()}
          className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          <Plus size={15} /> Add
        </button>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tags..."
          className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400" />
      </div>
      <div className="flex flex-wrap gap-2">
        {filtered.length === 0 && <p className="text-sm text-slate-400">No tags yet.</p>}
        {filtered.map((tag) => (
          <div key={tag.id} className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            <Tag size={11} className="text-slate-400" />
            {tag.name}
            <button type="button" onClick={() => void handleDelete(tag.id)}
              className="ml-1 text-slate-400 hover:text-red-600"><X size={12} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Posts List ───────────────────────────────────────────────────────────────────
interface PostsListProps {
  onEdit: (id: string) => void;
  onNew: () => void;
}

function PostsList({ onEdit, onNew }: PostsListProps) {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await blogService.listPosts({ status: statusFilter, search });
      setPosts(data);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this post?')) return;
    await blogService.deletePost(id);
    setPosts((p) => p.filter((post) => post.id !== id));
  };

  const handleDuplicate = async (id: string) => {
    const copy = await blogService.duplicatePost(id);
    setPosts((p) => [copy, ...p]);
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} post(s)?`)) return;
    await Promise.all([...selected].map((id) => blogService.deletePost(id)));
    setPosts((p) => p.filter((post) => !selected.has(post.id)));
    setSelected(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posts..."
            className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2.5 text-sm outline-none focus:border-slate-400" />
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {Object.entries(STATUS_LABELS).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setStatusFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === key ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">{selected.size} selected</span>
          <button type="button" onClick={() => void handleBulkDelete()}
            className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100">
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading
          ? <div className="flex items-center justify-center py-16"><Loader2 className="animate-spin text-slate-300" size={28} /></div>
          : posts.length === 0
            ? <div className="flex flex-col items-center py-16 gap-3">
                <FileText size={36} className="text-slate-200" />
                <p className="text-sm text-slate-400">No posts yet.</p>
                <button type="button" onClick={onNew}
                  className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">
                  <Plus size={14} /> Create your first post
                </button>
              </div>
            : <div className="divide-y divide-slate-100">
                <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50">
                  <span className="w-4" />
                  <span>Title</span>
                  <span className="hidden md:block">Category</span>
                  <span>Status</span>
                  <span className="hidden lg:block">Date</span>
                  <span>Actions</span>
                </div>
                {posts.map((post) => (
                  <div key={post.id} className="flex flex-col sm:grid sm:grid-cols-[auto_1fr_auto_auto_auto_auto] items-start sm:items-center gap-3 sm:gap-4 px-5 py-4 hover:bg-slate-50 transition">
                    <input type="checkbox" checked={selected.has(post.id)} onChange={() => toggleSelect(post.id)}
                      className="h-4 w-4 rounded border-slate-300 accent-slate-900 mt-1 sm:mt-0" />

                    <div className="min-w-0 flex-1 sm:flex-none">
                      {post.featured_image
                        ? <div className="flex items-center gap-3">
                            <img src={post.featured_image} alt="" className="h-10 w-14 rounded-lg object-cover shrink-0" />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</div>
                              {post.excerpt && <div className="truncate text-xs text-slate-400 mt-0.5">{post.excerpt}</div>}
                            </div>
                          </div>
                        : <div>
                            <div className="truncate text-sm font-semibold text-slate-900">{post.title || '(Untitled)'}</div>
                            {post.excerpt && <div className="truncate text-xs text-slate-400 mt-0.5">{post.excerpt}</div>}
                          </div>
                      }
                    </div>

                    <span className="hidden md:block text-xs text-slate-500">{post.category_name || '—'}</span>

                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_BADGE[post.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {post.status}
                    </span>

                    <span className="hidden lg:block text-xs text-slate-400">{fmtDate(post.published_at || post.updated_at)}</span>

                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => onEdit(post.id)} title="Edit"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil size={14} />
                      </button>
                      <button type="button" onClick={() => void handleDuplicate(post.id)} title="Duplicate"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Copy size={14} />
                      </button>
                      <button type="button" onClick={() => void handleDelete(post.id)} title="Delete"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
        }
      </div>
    </div>
  );
}

// ── Main Posts Page ──────────────────────────────────────────────────────────────
const Posts = () => {
  const [view, setView] = useState<PostsView>('posts');
  const [editPostId, setEditPostId] = useState<string | null>(null);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);

  const loadMeta = useCallback(async () => {
    const [cats, tgs] = await Promise.all([
      blogService.listCategories(),
      blogService.listTags(),
    ]);
    setCategories(cats);
    setTags(tgs);
  }, []);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  const openEditor = (id: string | null) => {
    setEditPostId(id);
    setView('editor');
  };

  const handlePostSaved = (_post: BlogPost) => {
    setView('posts');
    setEditPostId(null);
  };

  const NAV_TABS: { id: PostsView; label: string; icon: React.ElementType }[] = [
    { id: 'posts', label: 'All Posts', icon: FileText },
    { id: 'categories', label: 'Categories', icon: FolderOpen },
    { id: 'tags', label: 'Tags', icon: Tag },
  ];

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
              <button type="button" onClick={() => openEditor(null)}
                className="flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 shrink-0">
                <Plus size={16} /> Add Post
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 border-b border-slate-200 mt-6">
            {NAV_TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setView(id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px ${
                  view === id
                    ? 'border-slate-950 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}>
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'posts' && (
        <PostsList onEdit={(id) => openEditor(id)} onNew={() => openEditor(null)} />
      )}
      {view === 'editor' && (
        <PostEditor
          postId={editPostId}
          categories={categories}
          tags={tags}
          onSaved={handlePostSaved}
          onBack={() => { setView('posts'); setEditPostId(null); }}
        />
      )}
      {view === 'categories' && (
        <CategoriesTab categories={categories} onChange={() => void loadMeta()} />
      )}
      {view === 'tags' && (
        <TagsTab tags={tags} onChange={() => void loadMeta()} />
      )}
    </div>
  );
};

export default Posts;
