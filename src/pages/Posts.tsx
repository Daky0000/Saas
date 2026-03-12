import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Plus, Search, Pencil, Trash2, Copy, FileText, Tag, FolderOpen,
  Bold, Italic, List, ListOrdered, Quote, Code, Image as ImageIcon,
  Heading1, Heading2, Heading3, Undo2, Redo2, Link,
  Loader2, Check, X, Save, Globe, Clock, Zap, Send, RefreshCw,
  AlertCircle, AlertTriangle, CheckCircle2, XCircle, ExternalLink,
  ChevronDown,
  SlidersHorizontal,
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TiptapImage from '@tiptap/extension-image';
import { blogService, type BlogPost, type BlogCategory, type BlogTag, type BlogPostPayload } from '../services/blogService';
import { distributionService, type ConnectedPlatform, type PublishingLog } from '../services/distributionService';
import MediaLibraryModal from '../components/media/MediaLibraryModal';
import SeoScoreBadge from '../components/SeoScoreBadge';
import type { AppUser } from '../utils/userSession';
import { wordpressService } from '../services/wordpressService';

// ── Types ───────────────────────────────────────────────────────────────────────
type PostsView = 'posts' | 'editor' | 'categories' | 'tags' | 'automation';

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

const DIST_STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-yellow-100 text-yellow-700',
};

const PLATFORM_ICONS: Record<string, string> = {
  wordpress: '🌐',
  linkedin: 'in',
  twitter: '𝕏',
  instagram: '📸',
  facebook: '📘',
  tiktok: '🎵',
  threads: '@',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// ── Blog Post Editor ─────────────────────────────────────────────────────────────
interface PostEditorProps {
  postId: string | null;
  categories: BlogCategory[];
  tags: BlogTag[];
  profileWebsite: string;
  onSaved: (post: BlogPost) => void;
  onBack: () => void;
  onMetaRefresh: () => Promise<void>;
}

function PostEditor({ postId, categories, tags, profileWebsite, onSaved, onBack, onMetaRefresh }: PostEditorProps) {
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
  const [focusKeywords, setFocusKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [socialTitle, setSocialTitle] = useState('');
  const [socialDescription, setSocialDescription] = useState('');
  const [socialImage, setSocialImage] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'details' | 'seo'>('details');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [mediaPurpose, setMediaPurpose] = useState<'featured' | 'social' | 'content'>('featured');
  const contentLoadedRef = useRef(false);

  // Inline category/tag creation
  const [localCategories, setLocalCategories] = useState<BlogCategory[]>([]);
  const [showCatInput, setShowCatInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);
  const [localTags, setLocalTags] = useState<BlogTag[]>([]);
  const [showTagInput, setShowTagInput] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [creatingTag, setCreatingTag] = useState(false);

  // Distribution
  const [connectedPlatforms, setConnectedPlatforms] = useState<ConnectedPlatform[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [distributing, setDistributing] = useState(false);
  const [publishLogs, setPublishLogs] = useState<PublishingLog[]>([]);
  const [savedPostId, setSavedPostId] = useState<string | null>(postId);

  const allCategories = [...categories, ...localCategories];
  const allTags = [...tags, ...localTags];

  const postUrl = useMemo(() => {
    const rawBase = (profileWebsite || (typeof window !== 'undefined' ? window.location.origin : '')).trim();
    const base = rawBase ? rawBase.replace(/\/$/, '') : '';
    const cleanSlug = slug.trim();
    if (!base) return cleanSlug ? `/blog/${encodeURIComponent(cleanSlug)}` : '/blog';
    return cleanSlug ? `${base}/blog/${encodeURIComponent(cleanSlug)}` : `${base}/blog`;
  }, [profileWebsite, slug]);

  const hashtags = useMemo(() => {
    const map = new Map(allTags.map((t) => [t.id, t.name] as const));
    return selectedTagIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((name) => `#${String(name).trim().replace(/\s+/g, '').replace(/^#/, '')}`)
      .join(' ');
  }, [allTags, selectedTagIds]);

  const caption = useMemo(() => {
    const cap = excerpt.trim();
    return cap || title.trim();
  }, [excerpt, title]);

  // Lightweight copies for real-time SEO analysis (avoid heavy parsing during save).
  const [seoHtml, setSeoHtml] = useState('');
  const [seoText, setSeoText] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit,
      TiptapImage.configure({ allowBase64: true }),
    ],
    content: '',
    onUpdate: ({ editor }) => {
      setSeoHtml(editor.getHTML());
      setSeoText(editor.getText());
    },
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
        const keywords = (post.focus_keyword ?? '')
          .split(',')
          .map((kw) => kw.trim())
          .filter(Boolean);
        setFocusKeywords(keywords);
        setKeywordDraft('');
        setSocialTitle(post.social_title ?? '');
        setSocialDescription(post.social_description ?? '');
        setSocialImage(post.social_image ?? '');
        setScheduledAt(post.scheduled_at ? post.scheduled_at.slice(0, 16) : '');
        editor.commands.setContent(post.content || '');
        setSeoHtml(post.content || '');
        try {
          const text = new DOMParser().parseFromString(post.content || '', 'text/html').body.textContent || '';
          setSeoText(text);
        } catch {
          setSeoText('');
        }
        contentLoadedRef.current = true;
      })
      .catch(() => setError('Failed to load post'))
      .finally(() => setLoading(false));
  }, [postId, editor]);

  // Load connected platforms + existing publish logs
  useEffect(() => {
    distributionService.getConnectedPlatforms().then(setConnectedPlatforms).catch(() => {});
    if (postId) {
      distributionService.getStatus(postId).then(setPublishLogs).catch(() => {});
    }
  }, [postId]);

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
        meta_title: metaTitle, meta_description: metaDescription, focus_keyword: focusKeywords.join(', '),
        social_title: socialTitle, social_description: socialDescription, social_image: socialImage,
        scheduled_at: finalStatus === 'scheduled' ? scheduledAt : null,
        tag_ids: selectedTagIds,
      };
      const saved = postId
        ? await blogService.updatePost(postId, payload)
        : await blogService.createPost(payload);
      if (publishStatus) setStatus(publishStatus);
      setSavedPostId(saved.id);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDistribute = async () => {
    const targetId = savedPostId ?? postId;
    if (!targetId || selectedPlatforms.length === 0) return;
    setDistributing(true);
    try {
      const results = await distributionService.publish(targetId, selectedPlatforms);
      // Refresh publish logs
      const updated = await distributionService.getStatus(targetId);
      setPublishLogs(updated);
      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length > 0) {
        setError(`Some platforms failed: ${failed.map((f) => f.platform).join(', ')}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Distribution failed');
    } finally {
      setDistributing(false);
    }
  };

  const handleRetry = async (logId: string) => {
    const targetId = savedPostId ?? postId;
    if (!targetId) return;
    try {
      await distributionService.retry(logId);
      const updated = await distributionService.getStatus(targetId);
      setPublishLogs(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
    }
  };

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const cat = await blogService.createCategory(newCatName.trim());
      setLocalCategories((prev) => [...prev, cat]);
      setCategoryId(cat.id);
      setNewCatName('');
      setShowCatInput(false);
      await onMetaRefresh();
      setLocalCategories((prev) => prev.filter((c) => c.id !== cat.id));
    } catch {
      // ignore
    } finally {
      setCreatingCat(false);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    setCreatingTag(true);
    try {
      const tag = await blogService.createTag(newTagName.trim());
      setLocalTags((prev) => [...prev, tag]);
      setSelectedTagIds((prev) => [...prev, tag.id]);
      setNewTagName('');
      setShowTagInput(false);
      await onMetaRefresh();
      setLocalTags((prev) => prev.filter((t) => t.id !== tag.id));
    } catch {
      // ignore
    } finally {
      setCreatingTag(false);
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

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const normalizeKeyword = (raw: string) => raw.trim().replace(/\s+/g, ' ');
  const splitKeywords = (raw: string) =>
    raw
      .split(/[,\n]+/g)
      .map(normalizeKeyword)
      .filter(Boolean);

  const addKeywords = (raw: string) => {
    const next = splitKeywords(raw);
    if (!next.length) return;
    setFocusKeywords((prev) => {
      const seen = new Set(prev.map((k) => k.toLowerCase()));
      const merged = [...prev];
      for (const kw of next) {
        const key = kw.toLowerCase();
        if (seen.has(key)) continue;
        merged.push(kw);
        seen.add(key);
      }
      return merged;
    });
  };

  const removeKeyword = (kw: string) => {
    setFocusKeywords((prev) => prev.filter((k) => k !== kw));
  };

  type SeoCheckState = 'pass' | 'warn' | 'fail';
  type SeoChecklistItem = { id: string; label: string; state: SeoCheckState; detail?: string };

  const seoAnalysis = useMemo(() => {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

    const primaryKw = (focusKeywords[0] || '').trim().toLowerCase();
    const kws = focusKeywords.map((k) => k.trim().toLowerCase()).filter(Boolean);
    const titleLc = title.toLowerCase();
    const slugLc = slug.toLowerCase();
    const metaTitleLen = metaTitle.trim().length;
    const metaDescLen = metaDescription.trim().length;

    const words = seoText.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const textLc = seoText.toLowerCase();

    const countPhrase = (text: string, phrase: string) => {
      if (!phrase) return 0;
      let idx = 0;
      let count = 0;
      while (true) {
        idx = text.indexOf(phrase, idx);
        if (idx === -1) break;
        count++;
        idx += phrase.length;
      }
      return count;
    };

    const kwCount = primaryKw ? countPhrase(textLc, primaryKw) : 0;
    const keywordDensity = wordCount > 0 && primaryKw ? (kwCount / wordCount) * 100 : 0;

    let doc: Document | null = null;
    try {
      doc = new DOMParser().parseFromString(seoHtml || '', 'text/html');
    } catch {
      doc = null;
    }

    const firstPara = (doc?.querySelector('p')?.textContent || '').trim().toLowerCase();
    const contentH1Count = doc ? doc.querySelectorAll('h1').length : 0;
    const h2 = doc ? Array.from(doc.querySelectorAll('h2')).map((h) => (h.textContent || '').toLowerCase()) : [];
    const h3 = doc ? Array.from(doc.querySelectorAll('h3')).map((h) => (h.textContent || '').toLowerCase()) : [];

    const anchors = doc ? Array.from(doc.querySelectorAll('a[href]')) : [];
    const hrefs = anchors
      .map((a) => (a.getAttribute('href') || '').trim())
      .filter(Boolean)
      .filter((href) => !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:'));

    const normalizeWebsiteHost = (value: string) => {
      const v = (value || '').trim();
      if (!v) return '';
      try {
        const u = new URL(v.includes('://') ? v : `https://${v}`);
        return u.hostname;
      } catch {
        return '';
      }
    };

    const internalHost = normalizeWebsiteHost(profileWebsite) || hostname;
    const isInternal = (href: string) => {
      if (href.startsWith('/') || href.startsWith('#')) return true;
      if (!internalHost) return false;
      try {
        const u = new URL(href, `https://${internalHost}`);
        return u.hostname === internalHost;
      } catch {
        return false;
      }
    };
    const internalLinks = hrefs.filter((h) => isInternal(h)).length;
    const externalLinks = hrefs.filter((h) => h.startsWith('http') && !isInternal(h)).length;

    const imgs = doc ? Array.from(doc.querySelectorAll('img')) : [];
    const imagesCount = imgs.length;
    const imagesMissingAlt = imgs.filter((img) => !(img.getAttribute('alt') || '').trim()).length;

    const sentences = seoText
      .split(/[\.\!\?]+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    const sentenceWordLens = sentences.map((s) => s.split(/\s+/).filter(Boolean).length);
    const avgSentenceLen = sentenceWordLens.length
      ? sentenceWordLens.reduce((a, b) => a + b, 0) / sentenceWordLens.length
      : 0;

    const paragraphs = (doc ? Array.from(doc.querySelectorAll('p')) : [])
      .map((p) => (p.textContent || '').trim())
      .filter(Boolean);
    const paragraphSentenceCounts = paragraphs.map((p) =>
      p.split(/[\.\!\?]+/g).map((s) => s.trim()).filter(Boolean).length
    );
    const avgParagraphSentences = paragraphSentenceCounts.length
      ? paragraphSentenceCounts.reduce((a, b) => a + b, 0) / paragraphSentenceCounts.length
      : 0;

    const passiveMatches = seoText.match(/\b(was|were|is|are|been|being)\b\s+\b(\w+ed|known|seen|given|made|built|written)\b/gi) || [];
    const passiveRatio = sentences.length ? passiveMatches.length / sentences.length : 0;

    // Checklist (Pass/Warn/Fail)
    const checks: SeoChecklistItem[] = [];
    const push = (id: string, label: string, state: SeoCheckState, detail?: string) => checks.push({ id, label, state, detail });

    // Keyword optimization checks
    const hasKw = kws.length > 0;
    const includesAny = (text: string) => kws.some((k) => k && text.includes(k));
    push('kw_present', 'Focus keyword set', hasKw ? 'pass' : 'fail');
    push('kw_title', 'Keyword in title', hasKw && includesAny(titleLc) ? 'pass' : hasKw ? 'fail' : 'fail');
    push('kw_slug', 'Keyword in URL slug', hasKw && includesAny(slugLc) ? 'pass' : hasKw ? 'warn' : 'fail');
    push('kw_first_para', 'Keyword in first paragraph', hasKw && includesAny(firstPara) ? 'pass' : hasKw ? 'warn' : 'fail');
    push('kw_headings', 'Keyword in headings (H2/H3)', hasKw && includesAny(`${h2.join(' ')} ${h3.join(' ')}`) ? 'pass' : hasKw ? 'warn' : 'fail');
    const densityState: SeoCheckState =
      !primaryKw ? 'fail'
        : keywordDensity >= 0.5 && keywordDensity <= 2.5 ? 'pass'
          : keywordDensity >= 0.2 && keywordDensity < 0.5 ? 'warn'
            : keywordDensity > 2.5 && keywordDensity <= 3.5 ? 'warn'
              : 'fail';
    push('kw_density', 'Keyword density (0.5%–2.5%)', densityState, primaryKw ? `${keywordDensity.toFixed(2)}%` : undefined);

    // Content quality
    push('content_len', 'Content length (600+ words)', wordCount >= 600 ? 'pass' : wordCount >= 300 ? 'warn' : 'fail', `${wordCount} words`);
    const sentenceState: SeoCheckState =
      avgSentenceLen >= 15 && avgSentenceLen <= 20 ? 'pass'
        : avgSentenceLen >= 10 && avgSentenceLen < 15 ? 'warn'
          : avgSentenceLen > 20 && avgSentenceLen <= 25 ? 'warn'
            : 'fail';
    push('read_sentence', 'Average sentence length (15–20 words)', sentences.length ? sentenceState : 'fail', sentences.length ? `${avgSentenceLen.toFixed(1)} words` : 'No sentences');
    const paraState: SeoCheckState =
      avgParagraphSentences >= 2 && avgParagraphSentences <= 4 ? 'pass'
        : avgParagraphSentences >= 1 && avgParagraphSentences < 2 ? 'warn'
          : avgParagraphSentences > 4 && avgParagraphSentences <= 5 ? 'warn'
            : paragraphs.length ? 'fail' : 'fail';
    push('read_paragraph', 'Paragraph length (2–4 sentences)', paragraphs.length ? paraState : 'warn', paragraphs.length ? `${avgParagraphSentences.toFixed(1)} avg` : 'No paragraphs');
    push('read_passive', 'Passive voice usage (low)', passiveRatio <= 0.1 ? 'pass' : passiveRatio <= 0.2 ? 'warn' : 'fail', sentences.length ? `${Math.round(passiveRatio * 100)}%` : undefined);

    // Metadata
    const metaTitleState: SeoCheckState =
      metaTitleLen >= 50 && metaTitleLen <= 60 ? 'pass'
        : metaTitleLen >= 40 && metaTitleLen < 50 ? 'warn'
          : metaTitleLen > 60 && metaTitleLen <= 70 ? 'warn'
            : metaTitleLen ? 'fail' : 'fail';
    push('meta_title_len', 'Meta title length (50–60 chars)', metaTitleState, `${metaTitleLen} chars`);
    const metaDescState: SeoCheckState =
      metaDescLen >= 120 && metaDescLen <= 155 ? 'pass'
        : metaDescLen >= 90 && metaDescLen < 120 ? 'warn'
          : metaDescLen > 155 && metaDescLen <= 180 ? 'warn'
            : metaDescLen ? 'fail' : 'fail';
    push('meta_desc_len', 'Meta description length (120–155 chars)', metaDescState, `${metaDescLen} chars`);
    push('meta_kw_title', 'Keyword in meta title', hasKw && includesAny(metaTitle.toLowerCase()) ? 'pass' : hasKw ? 'warn' : 'fail');
    push('meta_kw_desc', 'Keyword in meta description', hasKw && includesAny(metaDescription.toLowerCase()) ? 'pass' : hasKw ? 'warn' : 'fail');

    // Structure & links
    const titleIsH1 = Boolean(title.trim());
    const h1State: SeoCheckState =
      !titleIsH1 ? 'fail'
        : contentH1Count === 0 ? 'pass'
          : contentH1Count === 1 ? 'warn'
            : 'fail';
    push('h1_once', 'Only one H1 (title)', h1State, !titleIsH1 ? 'Missing title' : `${contentH1Count} H1 in content`);
    push('h2_present', 'At least one H2', h2.length > 0 ? 'pass' : 'warn', `${h2.length}`);
    push('links_internal', 'Internal links (2+)', internalLinks >= 2 ? 'pass' : internalLinks === 1 ? 'warn' : 'fail', `${internalLinks}`);
    push('links_external', 'External links (1+)', externalLinks >= 1 ? 'pass' : 'warn', `${externalLinks}`);

    // Images
    push('img_featured', 'Featured image present', featuredImage ? 'pass' : 'warn');
    const altState: SeoCheckState =
      imagesCount === 0 ? 'warn'
        : imagesMissingAlt === 0 ? 'pass'
          : imagesMissingAlt < imagesCount ? 'warn'
            : 'fail';
    push('img_alt', 'Images have alt text', altState, imagesCount ? `${imagesCount - imagesMissingAlt}/${imagesCount}` : 'No images');

    // Scoring
    let score = 0;
    // Keyword optimization (30)
    if (hasKw && includesAny(titleLc)) score += 8;
    if (hasKw && includesAny(slugLc)) score += 5;
    if (hasKw && includesAny(firstPara)) score += 6;
    if (hasKw && includesAny(`${h2.join(' ')} ${h3.join(' ')}`)) score += 5;
    score += densityState === 'pass' ? 6 : densityState === 'warn' ? 3 : 0;
    // Content quality (25)
    score += wordCount >= 600 ? 15 : wordCount >= 300 ? 8 : 0;
    score += sentenceState === 'pass' ? 5 : sentenceState === 'warn' ? 3 : 0;
    score += paraState === 'pass' ? 5 : paraState === 'warn' ? 3 : 0;
    // Metadata (20)
    score += metaTitleState === 'pass' ? 6 : metaTitleState === 'warn' ? 3 : 0;
    score += metaDescState === 'pass' ? 8 : metaDescState === 'warn' ? 4 : 0;
    score += hasKw && includesAny(metaTitle.toLowerCase()) ? 3 : 0;
    score += hasKw && includesAny(metaDescription.toLowerCase()) ? 3 : 0;
    // Structure (15)
    score += titleIsH1 && contentH1Count === 0 ? 5 : 0;
    score += h2.length > 0 ? 5 : 0;
    score += internalLinks >= 2 ? 5 : internalLinks === 1 ? 3 : 0;
    // Images (10)
    score += featuredImage ? 4 : 0;
    score += altState === 'pass' ? 6 : altState === 'warn' ? 3 : 0;

    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade =
      score >= 80 ? 'Excellent'
        : score >= 60 ? 'Good'
          : score >= 40 ? 'Needs Improvement'
            : 'Poor';
    const colorClass =
      grade === 'Excellent' ? 'text-emerald-800'
        : grade === 'Good' ? 'text-emerald-600'
          : grade === 'Needs Improvement' ? 'text-amber-600'
            : 'text-red-600';

    const recommendations = checks
      .filter((c) => c.state !== 'pass')
      .slice(0, 7)
      .map((c) => {
        switch (c.id) {
          case 'kw_title': return 'Add your focus keyword to the post title.';
          case 'kw_slug': return 'Include your focus keyword in the URL slug.';
          case 'kw_first_para': return 'Use your focus keyword in the first paragraph.';
          case 'kw_headings': return 'Add your focus keyword to at least one H2 heading.';
          case 'kw_density': return 'Adjust keyword usage to keep density between 0.5% and 2.5%.';
          case 'content_len': return 'Increase content length to at least 600 words.';
          case 'links_internal': return 'Add at least 2 internal links to other posts/pages.';
          case 'links_external': return 'Add at least 1 external link to a reputable site.';
          case 'img_featured': return 'Add a featured image for better SEO and sharing.';
          case 'img_alt': return 'Add descriptive alt text to images.';
          case 'meta_title_len': return 'Tune meta title length to 50–60 characters.';
          case 'meta_desc_len': return 'Tune meta description length to 120–155 characters.';
          case 'meta_kw_title': return 'Include the focus keyword in the meta title.';
          case 'meta_kw_desc': return 'Include the focus keyword in the meta description.';
          case 'h1_once': return 'Use the title as the only H1; avoid H1 headings inside the editor content.';
          default: return `Improve: ${c.label}.`;
        }
      });

    return {
      score,
      grade,
      colorClass,
      checklist: checks,
      recommendations,
      stats: {
        wordCount,
        keywordDensity,
        internalLinks,
        externalLinks,
        imagesCount,
        imagesMissingAlt,
      },
    };
  }, [focusKeywords, title, slug, metaTitle, metaDescription, featuredImage, seoHtml, seoText, profileWebsite]);

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
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className={title.length > 60 ? 'font-semibold text-red-600' : 'text-slate-500'}>
                {title.length}/60
              </span>
              {title.length > 60 && (
                <span className="relative inline-flex items-center group">
                  <AlertCircle size={14} className="text-red-600" />
                  <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-64 rounded-lg bg-slate-950 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    Your title exceeds 60 chars, not good for SEO.
                  </span>
                </span>
              )}
            </div>
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

          <div className="rounded-2xl border border-slate-200 bg-white p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setSidebarTab('details')}
                className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                  sidebarTab === 'details' ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Post Details
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('seo')}
                className={`rounded-2xl px-4 py-2 text-sm font-bold transition ${
                  sidebarTab === 'seo' ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                SEO
              </button>
            </div>
          </div>

          {sidebarTab === 'details' ? (
            <>
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

          {/* Category with inline creation */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Category</h3>
              <button type="button" onClick={() => setShowCatInput((v) => !v)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <Plus size={12} /> New
              </button>
            </div>
            {showCatInput && (
              <div className="mb-3 flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateCategory(); if (e.key === 'Escape') setShowCatInput(false); }}
                  placeholder="Category name..."
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                />
                <button type="button" onClick={() => void handleCreateCategory()} disabled={creatingCat || !newCatName.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 text-white disabled:opacity-50">
                  {creatingCat ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                </button>
                <button type="button" onClick={() => setShowCatInput(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                  <X size={11} />
                </button>
              </div>
            )}
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-slate-400">
              <option value="">— No category —</option>
              {allCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Tags with inline creation */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Tags</h3>
              <button type="button" onClick={() => setShowTagInput((v) => !v)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800">
                <Plus size={12} /> New
              </button>
            </div>
            {showTagInput && (
              <div className="mb-3 flex gap-2">
                <input
                  autoFocus
                  type="text"
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleCreateTag(); if (e.key === 'Escape') setShowTagInput(false); }}
                  placeholder="Tag name..."
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs outline-none focus:border-slate-400"
                />
                <button type="button" onClick={() => void handleCreateTag()} disabled={creatingTag || !newTagName.trim()}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-950 text-white disabled:opacity-50">
                  {creatingTag ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                </button>
                <button type="button" onClick={() => setShowTagInput(false)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100">
                  <X size={11} />
                </button>
              </div>
            )}
            {allTags.length === 0
              ? <p className="text-xs text-slate-400">No tags yet. Click "+ New" to create one.</p>
              : <div className="flex flex-wrap gap-2">
                  {allTags.map((t) => {
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

          {/* Excerpt */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Excerpt</label>
            <textarea
              rows={3}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Short description shown in listings..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none resize-none focus:border-slate-400"
            />
          </div>

          {/* Distribution Settings */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={15} className="text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900">Distribution</h3>
            </div>
            {connectedPlatforms.length === 0
              ? <p className="text-xs text-slate-400 leading-relaxed">
                  No platforms connected. Visit{' '}
                  <button type="button" onClick={() => { window.history.pushState({}, '', '/integrations'); window.dispatchEvent(new PopStateEvent('popstate')); }}
                    className="text-blue-600 hover:underline">Integrations</button>{' '}
                  to connect platforms.
                </p>
              : <>
                  <p className="text-xs text-slate-500 mb-3">Select platforms to publish to after saving.</p>
                  <div className="space-y-2 mb-4">
                    {connectedPlatforms.map((p) => (
                      <label key={p.id} className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPlatforms.includes(p.id)}
                          onChange={() => togglePlatform(p.id)}
                          className="h-4 w-4 rounded border-slate-300 accent-slate-900"
                        />
                        <span className="text-lg leading-none">{PLATFORM_ICONS[p.id] ?? '🔗'}</span>
                        <span className="text-sm font-medium text-slate-700">{p.name}</span>
                      </label>
                    ))}
                  </div>
                  {selectedPlatforms.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleDistribute()}
                      disabled={distributing || !savedPostId}
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      {distributing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {distributing ? 'Publishing...' : `Publish to ${selectedPlatforms.length} platform${selectedPlatforms.length > 1 ? 's' : ''}`}
                    </button>
                  )}
                  {!savedPostId && selectedPlatforms.length > 0 && (
                    <p className="mt-2 text-xs text-slate-400">Save the post first to distribute.</p>
                  )}

                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black text-slate-700">Preview</div>
                    <p className="mt-1 text-xs text-slate-500">
                      Featured image, caption (excerpt), hashtags (tags), and post URL.
                    </p>
                    {featuredImage ? (
                      <img src={featuredImage} alt="" className="mt-3 h-44 w-full rounded-xl object-cover border border-slate-200 bg-white" />
                    ) : (
                      <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
                        No featured image selected.
                      </div>
                    )}
                    <div className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                      {[caption, hashtags, postUrl].filter(Boolean).join('\n\n')}
                    </div>
                  </div>
                </>
            }
          </div>

          {/* Publishing Status */}
          {publishLogs.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">Publishing Status</h3>
              <div className="space-y-2">
                {publishLogs.map((log) => (
                  <div key={log.id} className="flex items-center gap-3">
                    <span className="text-base leading-none">{PLATFORM_ICONS[log.platform] ?? '🔗'}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700 capitalize">{log.platform}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${DIST_STATUS_BADGE[log.status] ?? 'bg-slate-100 text-slate-600'}`}>
                          {log.status}
                        </span>
                      </div>
                      {log.error_message && (
                        <p className="text-xs text-red-600 mt-0.5 truncate">{log.error_message}</p>
                      )}
                    </div>
                    {log.status === 'failed' && (
                      <button type="button" onClick={() => void handleRetry(log.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
                        title="Retry">
                        <RefreshCw size={12} />
                      </button>
                    )}
                    {log.platform_post_id && log.status === 'published' && (
                      <span className="text-emerald-500"><CheckCircle2 size={14} /></span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
            </>
          ) : (
            <div className="space-y-4">
              {/* Focus keywords */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-2">
                <h3 className="text-sm font-bold text-slate-900">Focus Keywords</h3>
                {focusKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {focusKeywords.map((kw) => (
                      <span
                        key={kw}
                        className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                      >
                        {kw}
                        <button
                          type="button"
                          onClick={() => removeKeyword(kw)}
                          className="rounded-full p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
                          title="Remove keyword"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  value={keywordDraft}
                  onChange={(e) => setKeywordDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addKeywords(keywordDraft);
                      setKeywordDraft('');
                      return;
                    }
                    if (e.key === 'Backspace' && !keywordDraft && focusKeywords.length > 0) {
                      setFocusKeywords((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => {
                    if (!keywordDraft.trim()) return;
                    addKeywords(keywordDraft);
                    setKeywordDraft('');
                  }}
                  placeholder="Type a keyword and press Enter or comma"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                />
                <p className="text-xs text-slate-400">Add multiple keywords. The first keyword is used for density checks.</p>
              </div>

              {/* SEO score */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">SEO Score</p>
                    <div className="mt-1 flex items-end gap-2">
                      <span className={`text-5xl font-black leading-none ${seoAnalysis.colorClass}`}>{seoAnalysis.score}</span>
                      <span className="text-sm font-bold text-slate-400">/ 100</span>
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${seoAnalysis.colorClass}`}>Status: {seoAnalysis.grade}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {seoAnalysis.stats.wordCount} words · {seoAnalysis.stats.keywordDensity.toFixed(2)}% density
                    </p>
                  </div>
                  <SeoScoreBadge score={seoAnalysis.score} size={86} />
                </div>
                {seoAnalysis.score < 40 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                    Your SEO score is low. You can still publish, but improving SEO is recommended.
                  </div>
                )}
              </div>

              {/* Checklist */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900">SEO Checklist</h3>
                <div className="mt-3 space-y-2">
                  {seoAnalysis.checklist.map((item) => (
                    <div key={item.id} className="flex items-start gap-2.5">
                      {item.state === 'pass' ? (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                      ) : item.state === 'warn' ? (
                        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-500" />
                      ) : (
                        <XCircle size={16} className="mt-0.5 shrink-0 text-red-600" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-slate-700">{item.label}</div>
                        {item.detail && <div className="text-xs text-slate-400">{item.detail}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Meta optimization */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
                <h3 className="text-sm font-bold text-slate-900">Meta Optimization</h3>
                <label className="block space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-500">Meta Title</span>
                    <span className={`text-xs font-semibold ${metaTitle.trim().length > 60 ? 'text-red-600' : metaTitle.trim().length >= 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {metaTitle.trim().length}/60
                    </span>
                  </div>
                  <input
                    type="text"
                    value={metaTitle}
                    onChange={(e) => setMetaTitle(e.target.value)}
                    placeholder="Recommended: 50–60 characters"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-slate-400"
                  />
                </label>

                <label className="block space-y-2">
                  <div className="flex items-end justify-between gap-3">
                    <span className="text-xs font-semibold text-slate-500">Meta Description</span>
                    <span className={`text-xs font-semibold ${metaDescription.trim().length > 155 ? 'text-red-600' : metaDescription.trim().length >= 120 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {metaDescription.trim().length}/155
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    value={metaDescription}
                    onChange={(e) => setMetaDescription(e.target.value)}
                    placeholder="Recommended: 120–155 characters"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none resize-none focus:border-slate-400"
                  />
                </label>

                {/* Search snippet preview */}
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-emerald-700">{(typeof window !== 'undefined' ? window.location.host : 'example.com')}/blog/{slug || 'your-post'}</div>
                  <div className="mt-1 text-base font-semibold text-blue-700 leading-snug">
                    {(metaTitle.trim() || title || 'Untitled post').slice(0, 80)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 line-clamp-2">
                    {(metaDescription.trim() || excerpt || 'Add a meta description to improve click-through rates.').slice(0, 180)}
                  </div>
                </div>

                {/* Social (existing fields, unchanged) */}
                <details className="rounded-2xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-slate-700 select-none">Social Sharing</summary>
                  <div className="space-y-4 px-4 pb-4">
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

              {/* Recommendations */}
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-sm font-bold text-slate-900">SEO Recommendations</h3>
                <div className="mt-3 space-y-2">
                  {seoAnalysis.recommendations.length === 0 ? (
                    <p className="text-sm text-slate-500">No recommendations right now.</p>
                  ) : (
                    seoAnalysis.recommendations.map((rec) => (
                      <div key={rec} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {rec}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
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

// ── Automation Tab ────────────────────────────────────────────────────────────────
function AutomationTab() {
  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await distributionService.getLogs();
      setLogs(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleRetry = async (logId: string) => {
    setRetrying(logId);
    try {
      await distributionService.retry(logId);
      await load();
    } catch {
      // ignore
    } finally {
      setRetrying(null);
    }
  };

  const platforms = Array.from(new Set(logs.map((l) => l.platform)));
  const stats = {
    total: logs.length,
    published: logs.filter((l) => l.status === 'published').length,
    failed: logs.filter((l) => l.status === 'failed').length,
    pending: logs.filter((l) => l.status === 'pending').length,
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-black tracking-tight text-slate-950">Automation</h2>
        <p className="mt-1 text-sm text-slate-500">
          Monitor automated post distribution across your connected platforms.
        </p>
      </div>

      {/* Stats */}
      {logs.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total', value: stats.total, color: 'text-slate-900' },
            { label: 'Published', value: stats.published, color: 'text-emerald-600' },
            { label: 'Failed', value: stats.failed, color: 'text-red-600' },
            { label: 'Pending', value: stats.pending, color: 'text-yellow-600' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className={`text-2xl font-black ${color}`}>{value}</div>
              <div className="mt-0.5 text-xs font-semibold text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Connected platforms info */}
      {logs.length === 0 && !loading && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
          <Zap size={36} className="mx-auto mb-3 text-slate-200" />
          <h3 className="text-base font-bold text-slate-700">No distribution activity yet</h3>
          <p className="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
            Open a post in the editor and use the Distribution panel to publish to connected platforms.
          </p>
          {platforms.length === 0 && (
            <button type="button"
              onClick={() => { window.history.pushState({}, '', '/integrations'); window.dispatchEvent(new PopStateEvent('popstate')); }}
              className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 mx-auto">
              <ExternalLink size={14} /> Connect platforms
            </button>
          )}
        </div>
      )}

      {/* Logs table */}
      {logs.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50">
            <span>Post</span>
            <span>Platform</span>
            <span>Status</span>
            <span>Date</span>
            <span>Action</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading
              ? <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-slate-300" size={24} /></div>
              : logs.map((log) => (
                <div key={log.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_auto_auto_auto] items-start sm:items-center gap-2 sm:gap-4 px-5 py-4 hover:bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">{log.post_title || log.post_id}</div>
                    {log.error_message && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <AlertCircle size={11} className="text-red-400 shrink-0" />
                        <span className="truncate text-xs text-red-500">{log.error_message}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{PLATFORM_ICONS[log.platform] ?? '🔗'}</span>
                    <span className="text-xs font-medium text-slate-600 capitalize">{log.platform}</span>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DIST_STATUS_BADGE[log.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {log.status}
                  </span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(log.created_at)}</span>
                  <div className="flex items-center gap-1">
                    {log.status === 'failed' && (
                      <button type="button" onClick={() => void handleRetry(log.id)} disabled={retrying === log.id}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                        {retrying === log.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        Retry
                      </button>
                    )}
                    {log.status === 'published' && <CheckCircle2 size={16} className="text-emerald-500" />}
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

// ── Posts List ───────────────────────────────────────────────────────────────────
// New Automation UI (sub-tabs) - extends Automation only. Does not change post editor/publish logic.
function AutomationTabV2() {
  type AutomationSubTab = 'platforms' | 'accounts' | 'rules' | 'logs';
  const [subTab, setSubTab] = useState<AutomationSubTab>('accounts');
  const [customizePlatformId, setCustomizePlatformId] = useState<string | null>(null);
  // Keep legacy component referenced to satisfy TS noUnusedLocals while migrating UI safely.
  void AutomationTab;

  type ConnectedAccountRow = {
    id: string;
    platform: string;
    handle?: string | null;
    connected: boolean;
    expiresAt?: string | null;
  };

  const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
  const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com') ? '' : rawApiBaseUrl.replace(/\/$/, '');
  const INTEGRATION_STORAGE_KEY = 'integration-configs';
  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const goIntegrations = () => {
    window.history.pushState({}, '', '/integrations');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  const PLATFORM_DEFS: Array<{ id: string; label: string; description: string; kind: 'oauth' | 'external' }> = [
    { id: 'facebook', label: 'Facebook', description: 'Auto-share posts to pages or groups you connect.', kind: 'oauth' },
    { id: 'linkedin', label: 'LinkedIn', description: 'Publish updates to your profile or company presence.', kind: 'oauth' },
    { id: 'twitter', label: 'X', description: 'Share short-form updates with your audience on X.', kind: 'oauth' },
    { id: 'instagram', label: 'Instagram', description: 'Prepare captions and automate post publishing workflows.', kind: 'oauth' },
    { id: 'threads', label: 'Threads', description: 'Auto-publish short threads when your blog goes live.', kind: 'oauth' },
    { id: 'wordpress', label: 'WordPress', description: 'Send posts to your connected WordPress site.', kind: 'external' },
    { id: 'mailchimp', label: 'Mailchimp', description: 'Automate newsletter campaigns from new posts.', kind: 'external' },
  ];

  const [enabledIds, setEnabledIds] = useState<Set<string> | null>(null);
  const [loadingEnabled, setLoadingEnabled] = useState(false);
  const [accounts, setAccounts] = useState<ConnectedAccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [wpStatus, setWpStatus] = useState<{ loading: boolean; connected: boolean; siteUrl?: string }>({ loading: true, connected: false });
  const [mailchimpConnected, setMailchimpConnected] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Activity logs (existing functionality, shown under the Logs sub-tab)
  const [logs, setLogs] = useState<PublishingLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  const loadEnabled = useCallback(async () => {
    setLoadingEnabled(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/integrations/enabled`, { headers: authHeaders() });
      if (!res.ok) { setEnabledIds(new Set()); return; }
      const data = await res.json() as { success: boolean; enabled: string[] };
      setEnabledIds(data.success ? new Set(data.enabled) : new Set());
    } catch {
      setEnabledIds(new Set());
    } finally {
      setLoadingEnabled(false);
    }
  }, [API_BASE_URL]);

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/accounts`, { headers: authHeaders() });
      if (!res.ok) { setAccounts([]); return; }
      const data = await res.json() as { success: boolean; data: ConnectedAccountRow[] };
      setAccounts(data.success ? (data.data || []) : []);
    } catch {
      setAccounts([]);
    } finally {
      setLoadingAccounts(false);
    }
  }, [API_BASE_URL]);

  const loadWordPress = useCallback(async () => {
    setWpStatus({ loading: true, connected: false });
    try {
      const result = await wordpressService.getStatus();
      if (result.success) setWpStatus({ loading: false, connected: Boolean(result.connected), siteUrl: result.siteUrl });
      else setWpStatus({ loading: false, connected: false });
    } catch {
      setWpStatus({ loading: false, connected: false });
    }
  }, []);

  const loadMailchimp = useCallback(() => {
    try {
      const raw = localStorage.getItem(INTEGRATION_STORAGE_KEY);
      if (!raw) { setMailchimpConnected(false); return; }
      const all = JSON.parse(raw) as any;
      const cfg = all?.mailchimp;
      const values = cfg?.values || {};
      setMailchimpConnected(Boolean(cfg?.enabled) && Boolean(String(values.apiKey || '').trim()) && Boolean(String(values.serverPrefix || '').trim()));
    } catch {
      setMailchimpConnected(false);
    }
  }, [INTEGRATION_STORAGE_KEY]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const data = await distributionService.getLogs();
      setLogs(data);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    void loadEnabled();
    void loadAccounts();
    void loadWordPress();
    void loadLogs();
    loadMailchimp();
  }, [loadEnabled, loadAccounts, loadWordPress, loadLogs, loadMailchimp]);

  useEffect(() => {
    const onFocus = () => {
      void loadEnabled();
      void loadAccounts();
      void loadWordPress();
      loadMailchimp();
    };
    window.addEventListener('focus', onFocus);
    const interval = window.setInterval(onFocus, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(interval);
    };
  }, [loadEnabled, loadAccounts, loadWordPress, loadMailchimp]);

  const enabled = enabledIds ?? new Set<string>();
  const visiblePlatforms = useMemo(
    () => PLATFORM_DEFS.filter((p) => enabledIds !== null && enabled.has(p.id)),
    [enabledIds, enabled]
  );

  const accountsByPlatform = useMemo(() => {
    const map: Record<string, ConnectedAccountRow[]> = {};
    for (const a of accounts) {
      const key = String(a.platform || '').toLowerCase();
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [accounts]);

  const connectedPlatformIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of accounts) {
      if (a.connected) set.add(String(a.platform || '').toLowerCase());
    }
    if (wpStatus.connected) set.add('wordpress');
    if (mailchimpConnected) set.add('mailchimp');
    return set;
  }, [accounts, wpStatus.connected, mailchimpConnected]);

  const connectedPlatforms = useMemo(
    () => visiblePlatforms.filter((p) => connectedPlatformIds.has(p.id)),
    [visiblePlatforms, connectedPlatformIds],
  );

  // Local settings for the Automation tab UI (stored in browser). This does not change publish logic.
  const SETTINGS_KEY = 'posts-automation-settings';
  const DEFAULT_TEMPLATES: Record<string, string> = {
    facebook: '{excerpt}\n\n{hashtags}\n\nRead more:\n{post_url}\n\n{featured_image}',
    linkedin: '{excerpt}\n\n{hashtags}\n\nRead more:\n{post_url}\n\n{featured_image}',
    twitter: '{excerpt}\n\n{hashtags}\n\n{post_url}\n\n{featured_image}',
    instagram: '{excerpt}\n\n{hashtags}\n\n{post_url}\n\n{featured_image}',
    threads: '{excerpt}\n\n{hashtags}\n\n{post_url}\n\n{featured_image}',
    wordpress: '{title}\n\n{excerpt}\n\n{post_url}\n\n{featured_image}',
    mailchimp: 'Subject: {title}\n\n{excerpt}\n\n{hashtags}\n\nRead more:\n{post_url}\n\n{featured_image}',
  };

  const loadSettings = () => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? (JSON.parse(raw) as any) : {};
    } catch { return {}; }
  };
  const saveSettings = (next: any) => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };

  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteSaveMsg, setRemoteSaveMsg] = useState<string | null>(null);
  const [remoteSaveErr, setRemoteSaveErr] = useState<string | null>(null);

  const [facebookTarget, setFacebookTarget] = useState<'page' | 'group'>(() => (loadSettings().facebookTarget === 'group' ? 'group' : 'page'));
  const [platformEnabledMap, setPlatformEnabledMap] = useState<Record<string, boolean>>(() => {
    const s = loadSettings();
    return s.platformEnabledMap && typeof s.platformEnabledMap === 'object' ? s.platformEnabledMap : {};
  });
  const [selectedAccountMap, setSelectedAccountMap] = useState<Record<string, string>>(() => {
    const s = loadSettings();
    return s.selectedAccountMap && typeof s.selectedAccountMap === 'object' ? s.selectedAccountMap : {};
  });
  const [rules, setRules] = useState<{ whenPublished: boolean; whenScheduled: boolean; onlySelectedCategories: boolean; autoPostTo: string[] }>(() => {
    const s = loadSettings().rules || {};
    return {
      whenPublished: Boolean(s.whenPublished ?? true),
      whenScheduled: Boolean(s.whenScheduled ?? false),
      onlySelectedCategories: Boolean(s.onlySelectedCategories ?? false),
      autoPostTo: Array.isArray(s.autoPostTo) ? s.autoPostTo.map((x: any) => String(x)).filter(Boolean) : [],
    };
  });
  const [templates, setTemplates] = useState<Record<string, string>>(() => {
    const s = loadSettings().templates || {};
    return { ...DEFAULT_TEMPLATES, ...(typeof s === 'object' ? s : {}) };
  });
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('');

  const currentSnapshot = useMemo(
    () => JSON.stringify({ facebookTarget, platformEnabledMap, selectedAccountMap, rules, templates }),
    [facebookTarget, platformEnabledMap, selectedAccountMap, rules, templates],
  );
  const isDirty = Boolean(lastSavedSnapshot) && currentSnapshot !== lastSavedSnapshot;

  useEffect(() => {
    if (!lastSavedSnapshot) setLastSavedSnapshot(currentSnapshot);
  }, [currentSnapshot, lastSavedSnapshot]);

  const readApiJsonOrThrow = async <T,>(res: Response): Promise<T> => {
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
      throw new Error(`Invalid server response (${res.status}). ${preview || 'Expected JSON.'}`);
    }
  };

  useEffect(() => {
    const loadRemote = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/user-settings/${encodeURIComponent(SETTINGS_KEY)}`, { headers: authHeaders() });
        const data = res.ok ? await readApiJsonOrThrow<{ success: boolean; value?: unknown }>(res) : { success: false };
        if (!data.success || !data.value || typeof data.value !== 'object') return;
        const s = data.value as any;
        const normalizedValue = {
          facebookTarget: s.facebookTarget === 'group' ? 'group' : 'page',
          platformEnabledMap: s.platformEnabledMap && typeof s.platformEnabledMap === 'object' ? s.platformEnabledMap : {},
          selectedAccountMap: s.selectedAccountMap && typeof s.selectedAccountMap === 'object' ? s.selectedAccountMap : {},
          rules: {
            whenPublished: Boolean(s.rules?.whenPublished ?? true),
            whenScheduled: Boolean(s.rules?.whenScheduled ?? false),
            onlySelectedCategories: Boolean(s.rules?.onlySelectedCategories ?? false),
            autoPostTo: Array.isArray(s.rules?.autoPostTo) ? s.rules.autoPostTo.map((x: any) => String(x)).filter(Boolean) : [],
          },
          templates: s.templates && typeof s.templates === 'object' ? { ...DEFAULT_TEMPLATES, ...s.templates } : { ...DEFAULT_TEMPLATES },
        };
        setFacebookTarget(normalizedValue.facebookTarget as 'group' | 'page');
        setPlatformEnabledMap(normalizedValue.platformEnabledMap);
        setSelectedAccountMap(normalizedValue.selectedAccountMap);
        setRules(normalizedValue.rules);
        setTemplates(normalizedValue.templates);
        saveSettings(normalizedValue);
        setLastSavedSnapshot(JSON.stringify(normalizedValue));
      } catch {
        // ignore - localStorage fallback still works
      }
    };
    void loadRemote();
  }, [API_BASE_URL]);

  const saveRemote = async () => {
    setRemoteSaveMsg(null);
    setRemoteSaveErr(null);
    setRemoteSaving(true);
    try {
      if (!API_BASE_URL) throw new Error('API base URL is not configured');
      const value = { facebookTarget, platformEnabledMap, selectedAccountMap, rules, templates };
      const res = await fetch(`${API_BASE_URL}/api/user-settings/${encodeURIComponent(SETTINGS_KEY)}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      });
      const text = await res.text();
      const looksLikeMissingRoute = res.status === 404 && /Cannot PUT\s+\/api\/user-settings\//i.test(text);
      if (looksLikeMissingRoute) {
        saveSettings(value);
        setLastSavedSnapshot(currentSnapshot);
        setRemoteSaveMsg('Saved locally. Server save is unavailable until the API is redeployed.');
        return;
      }
      let data: { success: boolean; error?: string } | null = null;
      try {
        data = JSON.parse(text) as { success: boolean; error?: string };
      } catch {
        const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
        throw new Error(`Invalid server response (${res.status}). ${preview || 'Expected JSON.'}`);
      }
      if (!data.success) throw new Error(data.error || 'Failed to save');
      setRemoteSaveMsg('Saved.');
      saveSettings(value);
      setLastSavedSnapshot(currentSnapshot);
    } catch (e) {
      setRemoteSaveErr(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setRemoteSaving(false);
    }
  };

  useEffect(() => {
    const allowed = new Set(connectedPlatforms.map((p) => p.id));
    setRules((prev) => {
      const nextAuto = prev.autoPostTo.filter((id) => allowed.has(id));
      return nextAuto.length === prev.autoPostTo.length ? prev : { ...prev, autoPostTo: nextAuto };
    });
  }, [connectedPlatforms]);

  useEffect(() => {
    const current = loadSettings();
    saveSettings({ ...current, facebookTarget });
  }, [facebookTarget]);
  useEffect(() => {
    const current = loadSettings();
    saveSettings({ ...current, platformEnabledMap });
  }, [platformEnabledMap]);
  useEffect(() => {
    const current = loadSettings();
    saveSettings({ ...current, selectedAccountMap });
  }, [selectedAccountMap]);
  useEffect(() => {
    const current = loadSettings();
    saveSettings({ ...current, rules });
  }, [rules]);
  useEffect(() => {
    const current = loadSettings();
    saveSettings({ ...current, templates });
  }, [templates]);

  const base64UrlFromBytes = (bytes: Uint8Array) => {
    let str = '';
    for (const b of bytes) str += String.fromCharCode(b);
    const base64 = btoa(str);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };

  const createPkcePair = async () => {
    const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
    const codeVerifier = base64UrlFromBytes(verifierBytes);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
    const codeChallenge = base64UrlFromBytes(new Uint8Array(digest));
    return { codeVerifier, codeChallenge };
  };

  const beginOAuthConnect = useCallback(async (platformId: string) => {
    setError(null);
    setConnecting(platformId);
    try {
      const state =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? (crypto as any).randomUUID()
          : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const pkce = platformId === 'twitter' ? await createPkcePair() : null;

      const res = await fetch(`${API_BASE_URL}/api/oauth/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          state,
          platform: platformId,
          returnTo: '/posts?view=automation',
          ...(pkce ? { codeVerifier: pkce.codeVerifier } : {}),
        }),
      });
      if (!res.ok) throw new Error('Failed to start connection. Please try again.');

      const authorizeUrl = new URL(`${API_BASE_URL}/api/oauth/${platformId}/authorize-url`);
      authorizeUrl.searchParams.set('state', state);
      if (pkce) {
        authorizeUrl.searchParams.set('code_challenge', pkce.codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      }
      const urlRes = await fetch(authorizeUrl.toString(), {
        headers: authHeaders(),
      });
      const text = await urlRes.text();
      let data: { success: boolean; url?: string; error?: string };
      try {
        data = JSON.parse(text) as { success: boolean; url?: string; error?: string };
      } catch {
        const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
        data = { success: false, error: preview ? `Invalid server response. ${preview}` : 'Invalid server response.' };
      }
      if (!data.success || !data.url) throw new Error(data.error || 'Failed to build authorize URL');
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(null);
    }
  }, [API_BASE_URL]);

  const disconnect = useCallback(async (platformId: string) => {
    if (!confirm('Disconnect this account?')) return;
    setError(null);
    try {
      if (platformId === 'wordpress') {
        const res = await wordpressService.disconnect();
        if (!res.success) throw new Error(res.error || 'Failed to disconnect WordPress');
        await loadWordPress();
        return;
      }
      if (platformId === 'mailchimp') {
        try {
          const raw = localStorage.getItem(INTEGRATION_STORAGE_KEY);
          const next = raw ? JSON.parse(raw) as any : {};
          if (next.mailchimp) next.mailchimp.enabled = false;
          localStorage.setItem(INTEGRATION_STORAGE_KEY, JSON.stringify(next));
        } catch { /* ignore */ }
        setMailchimpConnected(false);
        return;
      }
      const res = await fetch(`${API_BASE_URL}/api/accounts/${encodeURIComponent(platformId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = res.ok ? await res.json() as { success: boolean; error?: string } : { success: false, error: 'Failed to disconnect' };
      if (!data.success) throw new Error(data.error || 'Failed to disconnect');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  }, [API_BASE_URL, loadAccounts, loadWordPress]);

  const handleRetry = useCallback(async (logId: string) => {
    setRetrying(logId);
    try {
      await distributionService.retry(logId);
      await loadLogs();
    } catch {
      // ignore
    } finally {
      setRetrying(null);
    }
  }, [loadLogs]);

  const getPrimaryAccountLabel = (platformId: string): string | null => {
    if (platformId === 'wordpress') return wpStatus.connected ? (wpStatus.siteUrl || 'WordPress site') : null;
    if (platformId === 'mailchimp') return mailchimpConnected ? 'Mailchimp account' : null;
    const list = accountsByPlatform[platformId] || [];
    const connected = list.find((a) => a.connected);
    if (!connected) return null;
    return connected.handle ? String(connected.handle) : `${platformId} account`;
  };

  const Toggle = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
    <button type="button" onClick={onClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-200'}`}>
      <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${on ? 'translate-x-5' : 'translate-x-1'}`} />
    </button>
  );

  const stats = useMemo(() => ({
    total: logs.length,
    published: logs.filter((l) => l.status === 'published').length,
    failed: logs.filter((l) => l.status === 'failed').length,
    pending: logs.filter((l) => l.status === 'pending').length,
  }), [logs]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-950">Automation</h2>
          <p className="mt-1 text-sm text-slate-500">
            Configure automatic publishing to connected platforms. All extra features live inside the Automation tab.
          </p>
          {isDirty && <div className="mt-2 text-xs font-semibold text-amber-600">Unsaved changes</div>}
          {remoteSaveMsg && <div className="mt-2 text-xs font-semibold text-emerald-600">{remoteSaveMsg}</div>}
          {remoteSaveErr && <div className="mt-2 text-xs font-semibold text-red-600">{remoteSaveErr}</div>}
        </div>
        <button
          type="button"
          onClick={() => void saveRemote()}
          disabled={remoteSaving || !isDirty}
          className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {remoteSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save changes
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 w-fit">
        {[
          { id: 'accounts', label: 'Connected Accounts' },
          { id: 'rules', label: 'Auto Posting Rules' },
          { id: 'logs', label: 'Activity Logs' },
        ].map((t) => (
          <button key={t.id} type="button" onClick={() => setSubTab(t.id as AutomationSubTab)}
            className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-colors ${
              subTab === t.id ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">{error}</div>
        </div>
      )}

      {subTab === 'platforms' && (
        <div className="space-y-4">
          {(enabledIds === null || loadingEnabled) && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 flex items-center gap-2">
              <Loader2 size={16} className="animate-spin text-slate-300" /> Loading available platforms...
            </div>
          )}

          {enabledIds !== null && visiblePlatforms.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center bg-white">
              <Zap size={36} className="mx-auto mb-3 text-slate-200" />
              <h3 className="text-base font-bold text-slate-700">No platforms enabled by admin</h3>
              <p className="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
                Enable social tools in the Admin dashboard to make them appear here.
              </p>
            </div>
          )}

          {enabledIds !== null && visiblePlatforms.map((p) => {
            const isOn = Boolean(platformEnabledMap[p.id]);
            const primary = getPrimaryAccountLabel(p.id);
            const isConnected = connectedPlatformIds.has(p.id);
            const list = accountsByPlatform[p.id] || [];

            const dropdownOptions =
              p.id === 'wordpress'
                ? (wpStatus.connected ? [{ id: 'wp', name: wpStatus.siteUrl || 'WordPress site' }] : [])
                : p.id === 'mailchimp'
                  ? (mailchimpConnected ? [{ id: 'mc', name: 'Mailchimp account' }] : [])
                  : list.filter((a) => a.connected).map((a) => ({ id: a.id, name: a.handle || `${p.label} account` }));

            const selected = selectedAccountMap[p.id] || '';

            return (
              <div key={p.id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-11 w-11 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-base shrink-0">
                      {PLATFORM_ICONS[p.id] ?? '⚙️'}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-black text-slate-900">{p.label}</h3>
                        {isConnected && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Connected</span>}
                        {!isConnected && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Not connected</span>}
                      </div>
                      <p className="mt-0.5 text-sm text-slate-500">{p.description}</p>
                      {p.id === 'facebook' && (
                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-600">Target:</span>
                          <select value={facebookTarget} onChange={(e) => setFacebookTarget(e.target.value === 'group' ? 'group' : 'page')}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-slate-400">
                            <option value="page">Page</option>
                            <option value="group">Group</option>
                          </select>
                        </div>
                      )}
                    </div>
                  </div>

                  <Toggle on={isOn} onClick={() => setPlatformEnabledMap((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} />
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-[1fr_320px]">
                  <div className="space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <select
                        value={selected}
                        onChange={(e) => setSelectedAccountMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
                        disabled={dropdownOptions.length === 0}
                      >
                        <option value="">{dropdownOptions.length ? 'Select account...' : 'No accounts connected'}</option>
                        {dropdownOptions.map((o) => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          if (p.kind === 'oauth') void beginOAuthConnect(p.id);
                          else goIntegrations();
                        }}
                        disabled={connecting === p.id}
                        className="flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                      >
                        {connecting === p.id ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                        Add New
                      </button>
                    </div>

                    <p className="text-xs text-slate-400">
                      {p.kind === 'oauth'
                        ? 'Click Add New to connect via OAuth and return here automatically.'
                        : 'This platform is configured from Integrations.'}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black text-slate-800">Preview</div>
                    {!primary && (
                      <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-400">
                        No connected account yet.
                      </div>
                    )}
                    {primary && (
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-11 w-11 rounded-full border border-slate-200 bg-white flex items-center justify-center text-base shrink-0">
                          {PLATFORM_ICONS[p.id] ?? '⚙️'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black text-slate-900">{primary}</div>
                          <div className="mt-0.5 text-xs text-slate-500">Automation toggle, edit, or remove.</div>
                        </div>
                        <Toggle on={isOn} onClick={() => setPlatformEnabledMap((prev) => ({ ...prev, [p.id]: !prev[p.id] }))} />
                        <button type="button" disabled title="Edit (coming soon)"
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 disabled:opacity-60">
                          <Pencil size={15} />
                        </button>
                        <button type="button" onClick={() => void disconnect(p.id)} title="Remove"
                          className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {subTab === 'accounts' && (
        <div className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900">Connected Accounts</h3>
              <p className="mt-1 text-sm text-slate-500">Only tools you’ve connected will appear here.</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={goIntegrations}
                className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
                <ExternalLink size={15} /> Integrations
              </button>
              <button type="button" onClick={() => { void loadAccounts(); void loadWordPress(); loadMailchimp(); }}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50">
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
          </div>

          {(loadingAccounts || wpStatus.loading) && (
            <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin text-slate-300" /> Loading connections...
            </div>
          )}

          <div className="mt-4 space-y-3">
            {connectedPlatforms.length === 0 && !loadingAccounts && !wpStatus.loading && (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center bg-white">
                <Zap size={36} className="mx-auto mb-3 text-slate-200" />
                <h3 className="text-base font-bold text-slate-700">No connected tools yet</h3>
                <p className="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
                  Connect your tools from the Integrations page, then come back here to manage them.
                </p>
                <button type="button" onClick={goIntegrations}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
                  <ExternalLink size={16} /> Go to Integrations
                </button>
              </div>
            )}

            {connectedPlatforms.map((p) => {
              const platformId = p.id;
              const primary = getPrimaryAccountLabel(platformId);
              const isConnected = true;

              let statusLabel = isConnected ? 'Connected' : 'Not connected';
              let statusClass = isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600';

              if (platformId !== 'wordpress' && platformId !== 'mailchimp') {
                const acc = (accountsByPlatform[platformId] || []).find((a) => a.connected);
                if (acc?.expiresAt) {
                  const expired = new Date(acc.expiresAt).getTime() < Date.now();
                  if (expired) {
                    statusLabel = 'Token expired';
                    statusClass = 'bg-orange-100 text-orange-700';
                  }
                }
              }

              return (
                <div key={platformId} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-base shrink-0">
                        {PLATFORM_ICONS[platformId] ?? '⚙️'}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-black text-slate-900">{p.label}</div>
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${statusClass}`}>{statusLabel}</span>
                        </div>
                        <div className="mt-0.5 text-sm text-slate-500 truncate">{primary || 'No account connected'}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setCustomizePlatformId((prev) => (prev === platformId ? null : platformId))}
                        className="flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                      >
                        <SlidersHorizontal size={16} /> Customize
                      </button>
                      <button type="button" onClick={() => void disconnect(platformId)}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-red-50 hover:text-red-600">
                        <Trash2 size={16} /> Remove
                      </button>
                    </div>
                  </div>

                  {customizePlatformId === platformId && (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                      <label className="flex items-start gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rules.autoPostTo.includes(platformId)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? Array.from(new Set([...rules.autoPostTo, platformId]))
                              : rules.autoPostTo.filter((x) => x !== platformId);
                            setRules((prev) => ({ ...prev, autoPostTo: next }));
                          }}
                          className="mt-1 h-4 w-4 rounded border-slate-300"
                        />
                        <div>
                          <div className="text-sm font-semibold text-slate-700">Automatically post to this platform</div>
                          <div className="text-xs text-slate-500">Used by “Post to connected accounts” and automation targets.</div>
                        </div>
                      </label>

                      {platformId === 'facebook' && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-slate-600">Facebook target:</span>
                          <select value={facebookTarget} onChange={(e) => setFacebookTarget(e.target.value === 'group' ? 'group' : 'page')}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-slate-400">
                            <option value="page">Page</option>
                            <option value="group">Group</option>
                          </select>
                        </div>
                      )}

                      {platformId !== 'wordpress' && platformId !== 'mailchimp' && (accountsByPlatform[platformId] || []).filter((a) => a.connected).length > 1 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-black text-slate-700">Account</div>
                          <select
                            value={selectedAccountMap[platformId] || ''}
                            onChange={(e) => setSelectedAccountMap((prev) => ({ ...prev, [platformId]: e.target.value }))}
                            className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 outline-none focus:border-slate-400"
                          >
                            <option value="">Default connected account</option>
                            {(accountsByPlatform[platformId] || []).filter((a) => a.connected).map((a) => (
                              <option key={a.id} value={a.id}>{a.handle || `${p.label} account`}</option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-xs font-black text-slate-700">Template</div>
                          <div className="text-xs text-slate-500">Used when automation runs.</div>
                        </div>
                        <button type="button" onClick={() => setTemplates((prev) => ({ ...prev, [platformId]: DEFAULT_TEMPLATES[platformId] || '' }))}
                          className="text-xs font-bold text-slate-700 hover:text-slate-950">
                          Reset
                        </button>
                      </div>
                      <textarea
                        value={templates[platformId] ?? ''}
                        onChange={(e) => setTemplates((prev) => ({ ...prev, [platformId]: e.target.value }))}
                        rows={5}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                      />

                      {p.kind === 'oauth' && (
                        <div className="flex items-center justify-end">
                          <button type="button" onClick={() => void beginOAuthConnect(platformId)} disabled={connecting === platformId}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
                            {connecting === platformId ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            Reconnect
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subTab === 'rules' && (
        <div className="space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <h3 className="text-sm font-black text-slate-900">Auto Posting Rules</h3>
            <p className="mt-1 text-sm text-slate-500">
              Configure automatic publishing behavior. Only connected platforms will show in templates below.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { id: 'whenPublished', label: 'Auto publish when post is published' },
                { id: 'whenScheduled', label: 'Auto publish when post is scheduled' },
                { id: 'onlySelectedCategories', label: 'Auto publish only for selected categories' },
              ].map((r) => (
                <label key={r.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(rules as any)[r.id]}
                    onChange={(e) => setRules((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                    className="mt-1 h-4 w-4 rounded border-slate-300"
                  />
                  <span className="text-sm font-semibold text-slate-700">{r.label}</span>
                </label>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-800">Automatically post to</div>
              <p className="mt-1 text-sm text-slate-500">
                These platforms will be used when you select “Post to connected accounts” from a post.
              </p>
              {connectedPlatforms.length === 0 ? (
                <div className="mt-3 text-sm text-slate-400">
                  No connected accounts.{' '}
                  <button type="button" onClick={goIntegrations} className="text-blue-600 hover:underline">Connect integrations</button>.
                </div>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {connectedPlatforms.map((p) => (
                    <label key={p.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={rules.autoPostTo.includes(p.id)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? Array.from(new Set([...rules.autoPostTo, p.id]))
                            : rules.autoPostTo.filter((x) => x !== p.id);
                          setRules((prev) => ({ ...prev, autoPostTo: next }));
                        }}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      <span className="text-base leading-none">{PLATFORM_ICONS[p.id] ?? '鈿欙笍'}</span>
                      <span className="text-sm font-semibold text-slate-700">{p.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-black text-slate-800">Variables</div>
              <p className="mt-1 text-sm text-slate-500">Use variables in templates:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {['{title}', '{excerpt}', '{content}', '{hashtags}', '{post_url}', '{featured_image}'].map((v) => (
                  <span key={v} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700">{v}</span>
                ))}
              </div>
            </div>
          </div>

          {Array.from(connectedPlatformIds)
            .filter((id) => enabled.has(id))
            .map((id) => (
              <div key={id} className="rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center text-base shrink-0">
                      {PLATFORM_ICONS[id] ?? '⚙️'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-black text-slate-900">{id === 'twitter' ? 'X' : id.charAt(0).toUpperCase() + id.slice(1)} format</div>
                      <div className="mt-0.5 text-sm text-slate-500">Template used when automation runs.</div>
                    </div>
                  </div>
                  <button type="button" onClick={() => setTemplates((prev) => ({ ...prev, [id]: DEFAULT_TEMPLATES[id] || '' }))}
                    className="text-xs font-bold text-slate-700 hover:text-slate-950">
                    Reset to default
                  </button>
                </div>

                <textarea
                  value={templates[id] ?? ''}
                  onChange={(e) => setTemplates((prev) => ({ ...prev, [id]: e.target.value }))}
                  rows={6}
                  className="mt-4 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-slate-400"
                />
              </div>
            ))}
        </div>
      )}

      {subTab === 'logs' && (
        <div className="space-y-6">
          {logs.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Total', value: stats.total, color: 'text-slate-900' },
                { label: 'Published', value: stats.published, color: 'text-emerald-600' },
                { label: 'Failed', value: stats.failed, color: 'text-red-600' },
                { label: 'Pending', value: stats.pending, color: 'text-yellow-600' },
              ].map(({ label, value, color }) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className={`text-2xl font-black ${color}`}>{value}</div>
                  <div className="mt-0.5 text-xs font-semibold text-slate-500">{label}</div>
                </div>
              ))}
            </div>
          )}

          {logs.length === 0 && !loadingLogs && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center bg-white">
              <Zap size={36} className="mx-auto mb-3 text-slate-200" />
              <h3 className="text-base font-bold text-slate-700">No automation activity yet</h3>
              <p className="mt-1 text-sm text-slate-400 max-w-sm mx-auto">
                Publish posts and view automation activity here. Connect integrations first if needed.
              </p>
            </div>
          )}

          {logs.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 bg-slate-50">
                <span>Post</span>
                <span>Platform</span>
                <span>Status</span>
                <span>Date</span>
                <span>Action</span>
              </div>
              <div className="divide-y divide-slate-100">
                {loadingLogs
                  ? <div className="flex items-center justify-center py-12"><Loader2 className="animate-spin text-slate-300" size={24} /></div>
                  : logs.map((log) => (
                    <div key={log.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_auto_auto_auto_auto] items-start sm:items-center gap-2 sm:gap-4 px-5 py-4 hover:bg-slate-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-slate-900">{log.post_title || log.post_id}</div>
                        {log.error_message && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <AlertCircle size={11} className="text-red-400 shrink-0" />
                            <span className="truncate text-xs text-red-500">{log.error_message}</span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{PLATFORM_ICONS[log.platform] ?? '⚙️'}</span>
                        <span className="text-xs font-medium text-slate-600 capitalize">{log.platform}</span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${DIST_STATUS_BADGE[log.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {log.status}
                      </span>
                      <span className="text-xs text-slate-400 whitespace-nowrap">{fmtDateTime(log.created_at)}</span>
                      <div className="flex items-center gap-1">
                        {log.status === 'failed' && (
                          <button type="button" onClick={() => void handleRetry(log.id)} disabled={retrying === log.id}
                            className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                            {retrying === log.id ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                            Retry
                          </button>
                        )}
                        {log.status === 'published' && <CheckCircle2 size={16} className="text-emerald-500" />}
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const SETTINGS_KEY = 'posts-automation-settings';
  const getAutoPostTargets = (): string[] => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) as any : {};
      const ids = parsed?.rules?.autoPostTo;
      return Array.isArray(ids) ? ids.map((x: any) => String(x)).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  useEffect(() => {
    const onClick = () => setOpenMenu(null);
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, []);

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

  const handleQuickPublish = async (postId: string) => {
    setPublishError(null);
    const targets = getAutoPostTargets();
    if (targets.length === 0) {
      setPublishError('No auto-post targets selected. Configure “Automatically post to” in Posts → Automation.');
      window.history.pushState({}, '', '/posts?view=automation');
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    setPublishingPostId(postId);
    try {
      const results = await distributionService.publish(postId, targets);
      const failed = results.filter((r) => r.status === 'failed');
      if (failed.length > 0) {
        setPublishError(`Some platforms failed: ${failed.map((f) => f.platform).join(', ')}`);
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : 'Publishing failed');
    } finally {
      setPublishingPostId(null);
    }
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
      {publishError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="min-w-0">{publishError}</div>
        </div>
      )}
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

      <div className="rounded-2xl border border-slate-200 bg-white overflow-visible">
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
                      <div className="relative">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenu((prev) => (prev === post.id ? null : post.id)); }}
                          title="Publish options"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          {publishingPostId === post.id ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
                        </button>
                        {openMenu === post.id && (
                          <div
                            className="absolute left-0 sm:left-auto sm:right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => { setOpenMenu(null); void handleQuickPublish(post.id); }}
                              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                            >
                              <Send size={14} className="text-slate-500" />
                              Post to connected accounts
                            </button>
                            <div className="px-3 py-2 text-xs text-slate-400 border-t border-slate-100">
                              Uses targets from Automation → “Automatically post to”.
                            </div>
                          </div>
                        )}
                      </div>
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
const Posts = ({ currentUser }: { currentUser: AppUser | null }) => {
  const [view, setView] = useState<PostsView>('posts');
  const [editPostId, setEditPostId] = useState<string | null>(null);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [tags, setTags] = useState<BlogTag[]>([]);

  // Support OAuth returnTo flows like `/posts?view=automation`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const desired = params.get('view');
    if (desired === 'automation') setView('automation');
    if (params.has('view')) {
      params.delete('view');
      const qs = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
    }
  }, []);

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
    { id: 'automation', label: 'Automation', icon: Zap },
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
          profileWebsite={currentUser?.website ?? ''}
          onSaved={handlePostSaved}
          onBack={() => { setView('posts'); setEditPostId(null); }}
          onMetaRefresh={loadMeta}
        />
      )}
      {view === 'categories' && (
        <CategoriesTab categories={categories} onChange={() => void loadMeta()} />
      )}
      {view === 'tags' && (
        <TagsTab tags={tags} onChange={() => void loadMeta()} />
      )}
      {view === 'automation' && (
        <AutomationTabV2 />
      )}
    </div>
  );
};

export default Posts;
