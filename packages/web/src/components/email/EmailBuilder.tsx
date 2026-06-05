import { useState, useRef, useCallback, type DragEvent } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Eye, Loader2, Minus,
  Monitor, Plus, Smartphone, Trash2, Type, X, Image as ImageIcon,
  Link, Layout, Code, Video as VideoIcon, Share2, List, GripVertical,
  ArrowLeft, Settings, ChevronDown, Mail, Hash,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right';
type PanelMode = 'add' | 'contents' | 'edit';
type AddTab = 'modules' | 'sections';

interface HeaderBlock {
  id: string; type: 'header';
  headline: string; subheadline: string;
  bgColor: string; textColor: string; align: Align; padding: number;
}
interface TextBlock {
  id: string; type: 'text';
  content: string; bgColor: string; textColor: string;
  fontSize: number; padding: number; lineHeight: number;
}
interface ImageBlock {
  id: string; type: 'image';
  src: string; alt: string; href: string; align: Align; padding: number;
}
interface ButtonBlock {
  id: string; type: 'button';
  text: string; href: string; bgColor: string; textColor: string;
  align: Align; padding: number; borderRadius: number; fontSize: number;
}
interface DividerBlock {
  id: string; type: 'divider';
  color: string; thickness: number; padding: number;
}
interface SpacerBlock {
  id: string; type: 'spacer'; height: number;
}
interface FooterBlock {
  id: string; type: 'footer';
  companyName: string; address: string; bgColor: string; textColor: string;
}
interface SocialBlock {
  id: string; type: 'social';
  links: Array<{ platform: string; url: string }>;
  align: Align; bgColor: string; padding: number; iconColor: string;
}
interface HtmlBlock {
  id: string; type: 'html';
  content: string; padding: number;
}
interface VideoBlock {
  id: string; type: 'video';
  thumbnailUrl: string; videoUrl: string; alt: string; align: Align; padding: number;
}

export type EmailBlock =
  | HeaderBlock | TextBlock | ImageBlock | ButtonBlock
  | DividerBlock | SpacerBlock | FooterBlock
  | SocialBlock | HtmlBlock | VideoBlock;

interface DragInfo {
  source: 'palette' | 'canvas';
  blockType?: EmailBlock['type'];
  blockId?: string;
}

// ─── HTML Generation ──────────────────────────────────────────────────────────

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook', twitter: 'X / Twitter', instagram: 'Instagram',
  linkedin: 'LinkedIn', youtube: 'YouTube',
};

function blockToHtml(block: EmailBlock): string {
  switch (block.type) {
    case 'header':
      return `<tr><td bgcolor="${block.bgColor}" align="${block.align}" style="padding:${block.padding}px;background-color:${block.bgColor};"><h1 style="margin:0;color:${block.textColor};font-size:30px;font-weight:700;line-height:1.3;font-family:Arial,sans-serif;">${block.headline}</h1>${block.subheadline ? `<p style="margin:10px 0 0;color:${block.textColor};font-size:17px;opacity:.85;font-family:Arial,sans-serif;">${block.subheadline}</p>` : ''}</td></tr>`;
    case 'text':
      return `<tr><td bgcolor="${block.bgColor}" style="padding:${block.padding}px;background-color:${block.bgColor};"><div style="color:${block.textColor};font-size:${block.fontSize}px;line-height:${block.lineHeight};font-family:Arial,sans-serif;">${block.content}</div></td></tr>`;
    case 'image': {
      const img = `<img src="${block.src}" alt="${block.alt}" style="max-width:100%;height:auto;display:block;" />`;
      return `<tr><td style="padding:${block.padding}px;text-align:${block.align};">${block.href ? `<a href="${block.href}" style="text-decoration:none;">${img}</a>` : img}</td></tr>`;
    }
    case 'button':
      return `<tr><td style="padding:${block.padding}px;text-align:${block.align};"><a href="${block.href}" style="display:inline-block;background-color:${block.bgColor};color:${block.textColor};font-size:${block.fontSize}px;font-weight:600;font-family:Arial,sans-serif;text-decoration:none;padding:14px 32px;border-radius:${block.borderRadius}px;">${block.text}</a></td></tr>`;
    case 'divider':
      return `<tr><td style="padding:${block.padding}px 0;"><hr style="border:none;border-top:${block.thickness}px solid ${block.color};margin:0;" /></td></tr>`;
    case 'spacer':
      return `<tr><td style="height:${block.height}px;line-height:${block.height}px;font-size:1px;">&nbsp;</td></tr>`;
    case 'footer':
      return `<tr><td bgcolor="${block.bgColor}" style="padding:28px 32px;background-color:${block.bgColor};text-align:center;"><p style="margin:0;color:${block.textColor};font-size:13px;font-family:Arial,sans-serif;opacity:.8;">${block.companyName}</p>${block.address ? `<p style="margin:4px 0 0;color:${block.textColor};font-size:12px;font-family:Arial,sans-serif;opacity:.6;">${block.address}</p>` : ''}<p style="margin:14px 0 0;"><a href="{{unsubscribe_url}}" style="color:${block.textColor};font-size:12px;font-family:Arial,sans-serif;opacity:.65;text-decoration:underline;">Unsubscribe</a></p></td></tr>`;
    case 'social':
      return `<tr><td bgcolor="${block.bgColor}" style="padding:${block.padding}px;background-color:${block.bgColor};text-align:${block.align};">${block.links.map(l => `<a href="${l.url}" style="display:inline-block;margin:0 8px;color:${block.iconColor};font-size:13px;font-family:Arial,sans-serif;text-decoration:none;font-weight:600;">${SOCIAL_LABELS[l.platform] || l.platform}</a>`).join('')}</td></tr>`;
    case 'html':
      return `<tr><td style="padding:${block.padding}px;">${block.content}</td></tr>`;
    case 'video': {
      const inner = block.thumbnailUrl
        ? `<img src="${block.thumbnailUrl}" alt="${block.alt}" style="max-width:100%;height:auto;display:block;" />`
        : `<div style="background:#1e293b;padding:40px 80px;color:#fff;font-family:Arial,sans-serif;font-size:18px;text-align:center;border-radius:8px;">&#9654; Watch Video</div>`;
      return `<tr><td style="padding:${block.padding}px;text-align:${block.align};"><a href="${block.videoUrl}" style="text-decoration:none;">${inner}</a></td></tr>`;
    }
  }
}

export function blocksToHtml(blocks: EmailBlock[]): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<style type="text/css">
body{margin:0;padding:0;background-color:#f4f4f7;-webkit-text-size-adjust:100%;}
table{border-collapse:collapse;}
img{border:0;display:block;max-width:100%;}
@media only screen and (max-width:600px){.email-container{width:100%!important;}}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;">
<center>
<table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:24px 16px;">
<table class="email-container" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
${blocks.map(blockToHtml).join('\n')}
</table>
</td></tr>
</table>
</center>
</body>
</html>`;
}

// ─── Block defaults ───────────────────────────────────────────────────────────

let _id = 1;
function uid() { return `b${_id++}`; }

function defaultBlock(type: EmailBlock['type']): EmailBlock {
  switch (type) {
    case 'header':  return { id: uid(), type: 'header', headline: 'Your Headline Here', subheadline: 'A short supporting tagline', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 40 };
    case 'text':    return { id: uid(), type: 'text', content: 'Write your email body here. You can use <strong>bold</strong>, <em>italic</em>, or <a href="#">links</a>.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.7 };
    case 'image':   return { id: uid(), type: 'image', src: '', alt: '', href: '', align: 'center', padding: 24 };
    case 'button':  return { id: uid(), type: 'button', text: 'Get Started', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 };
    case 'divider': return { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 16 };
    case 'spacer':  return { id: uid(), type: 'spacer', height: 24 };
    case 'footer':  return { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St, City, Country', bgColor: '#f9fafb', textColor: '#6b7280' };
    case 'social':  return { id: uid(), type: 'social', links: [{ platform: 'facebook', url: '#' }, { platform: 'twitter', url: '#' }, { platform: 'instagram', url: '#' }], align: 'center', bgColor: '#ffffff', padding: 24, iconColor: '#5b6cf9' };
    case 'html':    return { id: uid(), type: 'html', content: '<p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;">Custom HTML here</p>', padding: 24 };
    case 'video':   return { id: uid(), type: 'video', thumbnailUrl: '', videoUrl: '#', alt: 'Watch video', align: 'center', padding: 24 };
  }
}

// ─── Templates ────────────────────────────────────────────────────────────────

interface Template { id: string; name: string; emoji: string; description: string; blocks: () => EmailBlock[] }

const TEMPLATES: Template[] = [
  {
    id: 'blank', name: 'Blank', emoji: '📄', description: 'Start from scratch',
    blocks: () => [
      { id: uid(), type: 'header', headline: 'Welcome', subheadline: '', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 40 },
      { id: uid(), type: 'text', content: 'Write your message here.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.7 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'newsletter', name: 'Newsletter', emoji: '📰', description: 'Regular updates',
    blocks: () => [
      { id: uid(), type: 'header', headline: 'Monthly Newsletter', subheadline: 'Your roundup', bgColor: '#1e293b', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 0 },
      { id: uid(), type: 'text', content: '<strong>Hi {{first_name}},</strong><br/><br/>Here\'s what\'s been happening this month.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'button', text: 'Read More Stories', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 15 },
      { id: uid(), type: 'social', links: [{ platform: 'facebook', url: '#' }, { platform: 'twitter', url: '#' }, { platform: 'instagram', url: '#' }], align: 'center', bgColor: '#f9fafb', padding: 24, iconColor: '#5b6cf9' },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'promotional', name: 'Promotional', emoji: '🛍️', description: 'Sales & offers',
    blocks: () => [
      { id: uid(), type: 'header', headline: '🔥 Limited Time Offer', subheadline: 'Don\'t miss out', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: '<p style="font-size:36px;font-weight:700;text-align:center;color:#1e293b;margin:0;">50% OFF</p>', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.6 },
      { id: uid(), type: 'button', text: '🛍️ Shop Now', href: '#', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 10, fontSize: 17 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'welcome', name: 'Welcome Email', emoji: '👋', description: 'Greet new subscribers',
    blocks: () => [
      { id: uid(), type: 'header', headline: 'Welcome aboard, {{first_name}}! 👋', subheadline: 'We\'re so glad you\'re here', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: 'Hi {{first_name}},<br/><br/>Thank you for joining us! You\'re now part of our community.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'button', text: 'Get Started →', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'announcement', name: 'Announcement', emoji: '📣', description: 'Share big news',
    blocks: () => [
      { id: uid(), type: 'header', headline: '📣 Big News!', subheadline: 'We have an exciting announcement', bgColor: '#0f172a', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: 'Hi {{first_name}},<br/><br/>We\'ve been working on something big and we\'re finally ready to share it.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'button', text: 'Learn More', href: '#', bgColor: '#0f172a', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
];

// ─── Personalization tokens ───────────────────────────────────────────────────

const TOKENS = [
  { label: 'First Name', value: '{{first_name}}' },
  { label: 'Last Name', value: '{{last_name}}' },
  { label: 'Email', value: '{{email}}' },
  { label: 'Company', value: '{{company}}' },
];

// ─── Section presets ──────────────────────────────────────────────────────────

interface SectionPreset {
  id: string; name: string; layout: string;
  preview: string[][];
  blocks: () => EmailBlock[];
}

const SECTION_PRESETS: SectionPreset[] = [
  {
    id: 's1', name: '1 Column', layout: '1',
    preview: [['full']],
    blocks: () => [defaultBlock('text')],
  },
  {
    id: 's2', name: '2 Columns', layout: '2',
    preview: [['half', 'half']],
    blocks: () => [defaultBlock('text'), defaultBlock('text')],
  },
  {
    id: 's3', name: '3 Columns', layout: '3',
    preview: [['third', 'third', 'third']],
    blocks: () => [defaultBlock('text'), defaultBlock('text'), defaultBlock('text')],
  },
  {
    id: 's13', name: '1/3 : 2/3', layout: '1/3:2/3',
    preview: [['narrow', 'wide']],
    blocks: () => [defaultBlock('image'), defaultBlock('text')],
  },
  {
    id: 's31', name: '2/3 : 1/3', layout: '2/3:1/3',
    preview: [['wide', 'narrow']],
    blocks: () => [defaultBlock('text'), defaultBlock('image')],
  },
  {
    id: 's4', name: '4 Columns', layout: '4',
    preview: [['q', 'q', 'q', 'q']],
    blocks: () => [defaultBlock('text'), defaultBlock('text'), defaultBlock('text'), defaultBlock('text')],
  },
];

// ─── Drop indicator (inserted between blocks during drag) ─────────────────────

function DropIndicator() {
  return (
    <div className="relative z-20 mx-0 -my-0.5 flex items-center">
      <div className="h-3 w-3 shrink-0 rounded-full bg-[#5b6cf9]" />
      <div className="h-0.5 flex-1 bg-[#5b6cf9]" />
    </div>
  );
}

// ─── Canvas block renderer ────────────────────────────────────────────────────

function CanvasBlock({
  block, selected, onSelect, onDelete,
  onDragStart, onDragEnd, isDragging,
}: {
  block: EmailBlock; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void; isDragging: boolean;
}) {
  const ring = selected
    ? 'outline outline-2 outline-[#5b6cf9] outline-offset-[-2px]'
    : 'hover:outline hover:outline-1 hover:outline-slate-300 hover:outline-offset-[-1px]';

  const toolbar = selected && (
    <div className="absolute right-2 top-2 z-10 flex gap-1" onClick={e => e.stopPropagation()}>
      <button
        onClick={onDelete}
        className="flex h-6 w-6 items-center justify-center rounded bg-red-50 text-red-500 shadow hover:bg-red-100"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );

  const wrap = (content: React.ReactNode) => (
    <div
      className={`group relative cursor-pointer select-none transition-opacity ${ring} ${isDragging ? 'opacity-40' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      {/* Drag handle */}
      <div
        className={`absolute left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onMouseDown={e => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </div>
      {toolbar}
      {content}
    </div>
  );

  switch (block.type) {
    case 'header':
      return wrap(
        <div style={{ backgroundColor: block.bgColor, padding: block.padding, textAlign: block.align }}>
          <div style={{ color: block.textColor, fontSize: 26, fontWeight: 700, lineHeight: 1.3, fontFamily: 'Arial, sans-serif' }}>
            {block.headline || <em style={{ opacity: 0.4 }}>Headline…</em>}
          </div>
          {block.subheadline && (
            <div style={{ color: block.textColor, fontSize: 16, marginTop: 8, opacity: 0.85, fontFamily: 'Arial, sans-serif' }}>{block.subheadline}</div>
          )}
        </div>
      );
    case 'text':
      return wrap(
        <div style={{ backgroundColor: block.bgColor, padding: block.padding }}>
          <div
            style={{ color: block.textColor, fontSize: block.fontSize, lineHeight: block.lineHeight, fontFamily: 'Arial, sans-serif' }}
            dangerouslySetInnerHTML={{ __html: block.content || '<em style="opacity:.4">Text content…</em>' }}
          />
        </div>
      );
    case 'image':
      return wrap(
        <div style={{ padding: block.padding, textAlign: block.align }}>
          {block.src ? (
            <img src={block.src} alt={block.alt} style={{ maxWidth: '100%', height: 'auto', display: 'inline-block' }} />
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-10 text-slate-400">
              <ImageIcon size={28} />
              <span className="text-sm">Enter an image URL in the properties panel</span>
            </div>
          )}
        </div>
      );
    case 'button':
      return wrap(
        <div style={{ padding: block.padding, textAlign: block.align }}>
          <span style={{ display: 'inline-block', backgroundColor: block.bgColor, color: block.textColor, fontSize: block.fontSize, fontWeight: 600, padding: '14px 32px', borderRadius: block.borderRadius, fontFamily: 'Arial, sans-serif', cursor: 'default' }}>
            {block.text || 'Button Text'}
          </span>
        </div>
      );
    case 'divider':
      return wrap(
        <div style={{ padding: `${block.padding}px 32px` }}>
          <hr style={{ border: 'none', borderTop: `${block.thickness}px solid ${block.color}`, margin: 0 }} />
        </div>
      );
    case 'spacer':
      return wrap(
        <div style={{ height: block.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="text-[10px] font-mono text-slate-300">{block.height}px spacer</span>
        </div>
      );
    case 'footer':
      return wrap(
        <div style={{ backgroundColor: block.bgColor, padding: '24px 32px', textAlign: 'center' }}>
          <div style={{ color: block.textColor, fontSize: 13, fontFamily: 'Arial, sans-serif', opacity: 0.8 }}>{block.companyName}</div>
          {block.address && <div style={{ color: block.textColor, fontSize: 12, marginTop: 4, opacity: 0.6, fontFamily: 'Arial, sans-serif' }}>{block.address}</div>}
          <div style={{ marginTop: 12 }}>
            <span style={{ color: block.textColor, fontSize: 12, fontFamily: 'Arial, sans-serif', opacity: 0.65, textDecoration: 'underline', cursor: 'default' }}>Unsubscribe</span>
          </div>
        </div>
      );
    case 'social':
      return wrap(
        <div style={{ backgroundColor: block.bgColor, padding: block.padding, textAlign: block.align }}>
          <div className="flex flex-wrap items-center gap-3" style={{ justifyContent: block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start' }}>
            {block.links.map((l, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: block.iconColor, fontSize: 13, fontFamily: 'Arial, sans-serif', fontWeight: 600 }}>
                <Share2 size={14} />
                {SOCIAL_LABELS[l.platform] || l.platform}
              </span>
            ))}
          </div>
        </div>
      );
    case 'html':
      return wrap(
        <div style={{ padding: block.padding }}>
          <div className="rounded border border-dashed border-slate-200 bg-slate-50 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
              <Code size={11} /> HTML Block
            </div>
            <pre className="overflow-x-auto text-[11px] text-slate-500 whitespace-pre-wrap">{block.content.slice(0, 120)}{block.content.length > 120 ? '…' : ''}</pre>
          </div>
        </div>
      );
    case 'video':
      return wrap(
        <div style={{ padding: block.padding, textAlign: block.align }}>
          {block.thumbnailUrl ? (
            <div className="relative inline-block">
              <img src={block.thumbnailUrl} alt={block.alt} style={{ maxWidth: '100%', display: 'block' }} />
              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-800 shadow-lg">
                  <VideoIcon size={20} />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-10 text-slate-400">
              <VideoIcon size={28} />
              <span className="text-sm">Enter thumbnail URL in the properties panel</span>
            </div>
          )}
        </div>
      );
  }
}

// ─── Edit Panel (left context panel when block is selected) ───────────────────

function EditPanel({ block, onChange }: { block: EmailBlock; onChange: (b: EmailBlock) => void }) {
  const set = useCallback(<K extends string>(key: K, value: unknown) => {
    onChange({ ...block, [key]: value } as EmailBlock);
  }, [block, onChange]);

  const field = (label: string, children: React.ReactNode) => (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</label>
      {children}
    </div>
  );

  const inp = (key: string, value: string, placeholder?: string) => (
    <input
      value={value} placeholder={placeholder}
      onChange={e => set(key, e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]"
    />
  );

  const numInp = (key: string, value: number, min = 0, max = 999) => (
    <input
      type="number" min={min} max={max} value={value}
      onChange={e => set(key, Number(e.target.value))}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]"
    />
  );

  const colorInp = (key: string, value: string) => (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => set(key, e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5" />
      <input value={value} onChange={e => set(key, e.target.value)} className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#5b6cf9]" />
    </div>
  );

  const alignBtns = (key: string, value: Align) => (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {(['left', 'center', 'right'] as Align[]).map(a => (
        <button key={a} onClick={() => set(key, a)}
          className={`flex flex-1 items-center justify-center py-2 text-xs transition-colors ${value === a ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
          {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
        </button>
      ))}
    </div>
  );

  const ta = (key: string, value: string, rows = 5, placeholder?: string) => (
    <textarea
      value={value} rows={rows} placeholder={placeholder}
      onChange={e => set(key, e.target.value)}
      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]"
    />
  );

  const LABELS: Record<EmailBlock['type'], string> = {
    header: 'Header', text: 'Text', image: 'Image', button: 'Button',
    divider: 'Divider', spacer: 'Spacer', footer: 'Footer',
    social: 'Social', html: 'HTML', video: 'Video',
  };

  return (
    <div>
      {/* Panel header */}
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-[#5b6cf9]" />
          <span className="text-xs font-bold text-slate-700">Edit {LABELS[block.type]}</span>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {/* Content tab */}
        <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs font-semibold">
          <button className="flex-1 bg-slate-950 py-1.5 text-white">Content</button>
          <button className="flex-1 bg-white py-1.5 text-slate-500 hover:bg-slate-50">Styles</button>
        </div>

        {block.type === 'header' && <>
          {field('Headline', inp('headline', block.headline, 'Headline text…'))}
          {field('Subheadline', inp('subheadline', block.subheadline, 'Optional subheading…'))}
          {field('Background Color', colorInp('bgColor', block.bgColor))}
          {field('Text Color', colorInp('textColor', block.textColor))}
          {field('Alignment', alignBtns('align', block.align))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
        </>}

        {block.type === 'text' && <>
          {field('Content (HTML supported)', ta('content', block.content, 6, 'Your text here…'))}
          <div className="rounded-lg bg-blue-50 p-2.5">
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-500">Personalization</p>
            <div className="flex flex-wrap gap-1">
              {TOKENS.map(t => (
                <button key={t.value} onClick={() => set('content', block.content + t.value)}
                  className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-200">
                  {t.value}
                </button>
              ))}
            </div>
          </div>
          {field('Background Color', colorInp('bgColor', block.bgColor))}
          {field('Text Color', colorInp('textColor', block.textColor))}
          {field('Font Size (px)', numInp('fontSize', block.fontSize, 10, 48))}
          {field('Line Height', <input type="number" min={1} max={3} step={0.1} value={block.lineHeight} onChange={e => set('lineHeight', parseFloat(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />)}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
        </>}

        {block.type === 'image' && <>
          {field('Visibility', <div className="flex gap-1"><button className="flex-1 rounded-lg border border-[#5b6cf9] bg-indigo-50 py-1.5 text-xs font-semibold text-[#5b6cf9]">Show</button><button className="flex-1 rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50">Hide</button></div>)}
          {field('Alignment', alignBtns('align', block.align))}
          {field('Corner Radius', numInp('cornerRadius' as never, 0, 0, 50))}
          {field('Image URL', inp('src', block.src, 'https://…'))}
          {field('Alt Text', inp('alt', block.alt, 'Image description'))}
          {field('Link URL (optional)', inp('href', block.href, 'https://…'))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
        </>}

        {block.type === 'button' && <>
          {field('Button Text', inp('text', block.text, 'Click here…'))}
          {field('Button URL', inp('href', block.href, 'https://…'))}
          {field('Background Color', colorInp('bgColor', block.bgColor))}
          {field('Text Color', colorInp('textColor', block.textColor))}
          {field('Alignment', alignBtns('align', block.align))}
          {field('Font Size (px)', numInp('fontSize', block.fontSize, 10, 36))}
          {field('Border Radius (px)', numInp('borderRadius', block.borderRadius, 0, 50))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
        </>}

        {block.type === 'divider' && <>
          {field('Color', colorInp('color', block.color))}
          {field('Thickness (px)', numInp('thickness', block.thickness, 1, 10))}
          {field('Vertical Padding (px)', numInp('padding', block.padding, 0, 60))}
        </>}

        {block.type === 'spacer' && <>
          {field('Height (px)', numInp('height', block.height, 4, 200))}
        </>}

        {block.type === 'footer' && <>
          {field('Company Name', inp('companyName', block.companyName, 'Your Company'))}
          {field('Address', inp('address', block.address, '123 Street, City'))}
          {field('Background Color', colorInp('bgColor', block.bgColor))}
          {field('Text Color', colorInp('textColor', block.textColor))}
          <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">
            Unsubscribe link auto-appended via <code>{'{{unsubscribe_url}}'}</code>.
          </p>
        </>}

        {block.type === 'social' && <>
          {field('Alignment', alignBtns('align', block.align))}
          {field('Icon Color', colorInp('iconColor', block.iconColor))}
          {field('Background Color', colorInp('bgColor', block.bgColor))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
          <div className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Social Links</label>
            {block.links.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={l.platform}
                  onChange={e => {
                    const links = [...block.links];
                    links[i] = { ...links[i], platform: e.target.value };
                    set('links', links);
                  }}
                  className="w-28 shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-[#5b6cf9]"
                >
                  {['facebook','twitter','instagram','linkedin','youtube'].map(p => (
                    <option key={p} value={p}>{SOCIAL_LABELS[p]}</option>
                  ))}
                </select>
                <input
                  value={l.url}
                  onChange={e => {
                    const links = [...block.links];
                    links[i] = { ...links[i], url: e.target.value };
                    set('links', links);
                  }}
                  placeholder="URL"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:border-[#5b6cf9]"
                />
                <button
                  onClick={() => set('links', block.links.filter((_, j) => j !== i))}
                  className="shrink-0 text-slate-300 hover:text-red-500"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              onClick={() => set('links', [...block.links, { platform: 'facebook', url: '#' }])}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-1.5 text-xs text-slate-500 hover:border-[#5b6cf9] hover:text-[#5b6cf9]"
            >
              <Plus size={11} /> Add Platform
            </button>
          </div>
        </>}

        {block.type === 'html' && <>
          {field('HTML Content', ta('content', block.content, 8, '<p>Your HTML here…</p>'))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
          <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">
            Use inline styles only — email clients don't support external CSS.
          </p>
        </>}

        {block.type === 'video' && <>
          {field('Thumbnail URL', inp('thumbnailUrl', block.thumbnailUrl, 'https://…'))}
          {field('Video URL (link)', inp('videoUrl', block.videoUrl, 'https://…'))}
          {field('Alt Text', inp('alt', block.alt, 'Watch video'))}
          {field('Alignment', alignBtns('align', block.align))}
          {field('Padding (px)', numInp('padding', block.padding, 0, 120))}
          <p className="rounded-lg bg-blue-50 p-2.5 text-[11px] text-blue-700">
            Video embeds don't work in email. The thumbnail links to your video URL.
          </p>
        </>}
      </div>
    </div>
  );
}

// ─── Add Panel ────────────────────────────────────────────────────────────────

const MODULE_PALETTE: Array<{ type: EmailBlock['type']; label: string; icon: React.ElementType; desc: string }> = [
  { type: 'text',    label: 'Text',    icon: Type,      desc: 'Rich text content' },
  { type: 'button',  label: 'Button',  icon: Link,      desc: 'Call-to-action link' },
  { type: 'social',  label: 'Social',  icon: Share2,    desc: 'Social media links' },
  { type: 'html',    label: 'HTML',    icon: Code,      desc: 'Raw HTML block' },
  { type: 'image',   label: 'Image',   icon: ImageIcon, desc: 'Photo or graphic' },
  { type: 'video',   label: 'Video',   icon: VideoIcon, desc: 'Video with thumbnail' },
  { type: 'divider', label: 'Divider', icon: Minus,     desc: 'Horizontal rule' },
  { type: 'header',  label: 'Header',  icon: Hash,      desc: 'Banner headline' },
  { type: 'footer',  label: 'Footer',  icon: Mail,      desc: 'Footer with unsubscribe' },
];

function SectionIcon({ layout }: { layout: string }) {
  const map: Record<string, React.ReactNode> = {
    '1': <div className="h-8 w-full rounded border-2 border-current" />,
    '2': <div className="flex gap-1"><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /></div>,
    '3': <div className="flex gap-0.5"><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /></div>,
    '1/3:2/3': <div className="flex gap-1"><div className="h-8 w-1/3 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /></div>,
    '2/3:1/3': <div className="flex gap-1"><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 w-1/3 rounded border-2 border-current" /></div>,
    '4': <div className="flex gap-0.5"><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /><div className="h-8 flex-1 rounded border-2 border-current" /></div>,
  };
  return <div className="text-slate-400">{map[layout] || null}</div>;
}

function AddPanel({
  onAddBlock, onDragStartPalette, onDragStartSection,
}: {
  onAddBlock: (type: EmailBlock['type']) => void;
  onDragStartPalette: (e: DragEvent<HTMLDivElement>, type: EmailBlock['type']) => void;
  onDragStartSection: (e: DragEvent<HTMLDivElement>, preset: SectionPreset) => void;
}) {
  const [tab, setTab] = useState<AddTab>('modules');

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
        <span className="text-xs font-bold text-slate-700">Add</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100">
        <button
          onClick={() => setTab('modules')}
          className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === 'modules' ? 'border-b-2 border-[#5b6cf9] text-[#5b6cf9]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Modules
        </button>
        <button
          onClick={() => setTab('sections')}
          className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === 'sections' ? 'border-b-2 border-[#5b6cf9] text-[#5b6cf9]' : 'text-slate-500 hover:text-slate-700'}`}
        >
          Sections
        </button>
      </div>

      {tab === 'modules' && (
        <div className="p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">All default modules ({MODULE_PALETTE.length})</div>
          <div className="grid grid-cols-2 gap-2">
            {MODULE_PALETTE.map(({ type, label, icon: Icon, desc }) => (
              <div
                key={type}
                draggable
                onDragStart={e => onDragStartPalette(e, type)}
                onClick={() => onAddBlock(type)}
                className="flex cursor-grab flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 hover:border-[#5b6cf9] hover:bg-indigo-50 active:cursor-grabbing transition-colors"
                title={desc}
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                    <Icon size={15} />
                  </div>
                </div>
                <span className="text-xs font-semibold text-slate-700">{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'sections' && (
        <div className="p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Default sections</div>
          <div className="grid grid-cols-2 gap-2">
            {SECTION_PRESETS.map(preset => (
              <div
                key={preset.id}
                draggable
                onDragStart={e => onDragStartSection(e, preset)}
                onClick={() => preset.blocks().forEach(b => onAddBlock(b.type))}
                className="flex cursor-grab flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 hover:border-[#5b6cf9] hover:bg-indigo-50 active:cursor-grabbing transition-colors"
              >
                <SectionIcon layout={preset.layout} />
                <span className="text-[11px] font-semibold text-slate-600">{preset.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contents Panel ───────────────────────────────────────────────────────────

function ContentsPanel({
  blocks, selectedId, subject, previewText,
  onSelectBlock,
}: {
  blocks: EmailBlock[]; selectedId: string | null;
  subject: string; previewText: string;
  onSelectBlock: (id: string) => void;
}) {
  const ICON: Record<EmailBlock['type'], React.ElementType> = {
    header: Hash, text: Type, image: ImageIcon, button: Link,
    divider: Minus, spacer: Layout, footer: Mail,
    social: Share2, html: Code, video: VideoIcon,
  };

  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
        <span className="text-xs font-bold text-slate-700">Contents</span>
      </div>

      {/* Inbox content */}
      <div className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Inbox content</span>
        </div>
        {[
          { label: 'Subject line', value: subject || '—' },
          { label: 'Preview text', value: previewText || '—' },
        ].map(row => (
          <div key={row.label} className="flex items-start gap-2 py-2">
            <Mail size={13} className="mt-0.5 shrink-0 text-slate-400" />
            <div>
              <div className="text-[11px] font-semibold text-slate-500">{row.label}</div>
              <div className="text-xs text-slate-700 truncate max-w-[160px]">{row.value}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email body</span>
          <span className="text-[10px] text-slate-400">{blocks.length} blocks</span>
        </div>

        <div className="space-y-0.5">
          {blocks.map((block, i) => {
            const Icon = ICON[block.type] || Layout;
            const label = block.type === 'header' ? (block as HeaderBlock).headline?.slice(0, 24) || 'Header'
              : block.type === 'text' ? 'Text'
              : block.type === 'image' ? ((block as ImageBlock).alt || 'Image')
              : block.type === 'button' ? ((block as ButtonBlock).text || 'Button')
              : block.type.charAt(0).toUpperCase() + block.type.slice(1);

            return (
              <button
                key={block.id}
                onClick={() => onSelectBlock(block.id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${selectedId === block.id ? 'bg-indigo-50 text-[#5b6cf9]' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                <Icon size={13} className="shrink-0" />
                <span className="flex-1 truncate text-xs font-medium">{label}</span>
                <span className="shrink-0 text-[10px] text-slate-300">{i + 1}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900">
      <div className="flex h-14 items-center justify-between border-b border-slate-700 px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Preview</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-600">
            <button onClick={() => setDevice('desktop')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${device === 'desktop' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Monitor size={13} /> Desktop
            </button>
            <button onClick={() => setDevice('mobile')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors ${device === 'mobile' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Smartphone size={13} /> Mobile
            </button>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"><X size={18} /></button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-800 p-8">
        <div
          className="overflow-hidden rounded-lg shadow-2xl transition-all duration-300"
          style={{ width: device === 'mobile' ? 390 : 700, background: '#f4f4f7' }}
        >
          <iframe
            srcDoc={html}
            title="Email Preview"
            className="block w-full border-0"
            style={{ height: device === 'mobile' ? 720 : 600, width: device === 'mobile' ? 390 : 700 }}
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Template Picker ──────────────────────────────────────────────────────────

function TemplatePicker({ onSelect, onClose }: { onSelect: (t: Template) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-lg font-black text-slate-950">Choose a Template</h2>
            <p className="mt-0.5 text-sm text-slate-500">Start with a pre-built layout or build from scratch.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onSelect(t)}
              className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-[#5b6cf9] hover:bg-indigo-50 transition-all">
              <span className="text-2xl">{t.emoji}</span>
              <div>
                <div className="text-sm font-bold text-slate-900">{t.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pre-send Checklist ───────────────────────────────────────────────────────

function PreSendChecklist({
  blocks, subject, hasContacts, onSend, onClose, sending,
}: {
  blocks: EmailBlock[]; subject: string; hasContacts: boolean;
  onSend: () => void; onClose: () => void; sending: boolean;
}) {
  const checks = [
    { label: 'Subject line is set', ok: subject.trim().length > 0, required: true },
    { label: 'Email has content blocks', ok: blocks.length > 2, required: true },
    { label: 'At least one text block', ok: blocks.some(b => b.type === 'text' || b.type === 'header'), required: true },
    { label: 'Button has a URL', ok: !blocks.some(b => b.type === 'button' && !(b as ButtonBlock).href), required: false },
    { label: 'Images have alt text', ok: !blocks.some(b => b.type === 'image' && (b as ImageBlock).src && !(b as ImageBlock).alt), required: false },
    { label: 'Footer block included', ok: blocks.some(b => b.type === 'footer'), required: false },
    { label: 'Recipients selected', ok: hasContacts, required: true },
  ];
  const errors = checks.filter(c => c.required && !c.ok);
  const warnings = checks.filter(c => !c.required && !c.ok);
  const canSend = errors.length === 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-black text-slate-950">Review and send</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        {(errors.length > 0 || warnings.length > 0) && (
          <div className="border-b border-slate-100 px-6 py-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-800">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-500 text-[10px]">!</span>
              Required fields and warnings
            </div>
            <div className="space-y-1.5">
              {errors.map((c, i) => (
                <div key={i} className="text-sm text-red-600">{i + 1}. <span className="font-semibold text-[#5b6cf9]">{c.label}</span> is required.</div>
              ))}
              {warnings.map((c, i) => (
                <div key={i} className="text-sm text-amber-600">{errors.length + i + 1}. {c.label}</div>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2 p-6">
          {checks.map((c, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${c.ok ? 'bg-emerald-50' : c.required ? 'bg-red-50' : 'bg-amber-50'}`}>
              <span className={`text-base ${c.ok ? 'text-emerald-500' : c.required ? 'text-red-500' : 'text-amber-500'}`}>
                {c.ok ? '✓' : c.required ? '✗' : '⚠'}
              </span>
              <span className={`text-sm font-medium ${c.ok ? 'text-emerald-700' : c.required ? 'text-red-700' : 'text-amber-700'}`}>{c.label}</span>
              {!c.ok && !c.required && <span className="ml-auto text-[10px] text-amber-500 font-semibold">Optional</span>}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Back to Editor</button>
          <button disabled={!canSend || sending} onClick={onSend}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main EmailBuilder ────────────────────────────────────────────────────────

export interface EmailBuilderProps {
  subject: string;
  previewText: string;
  segmentId?: string;
  segments?: Array<{ id: string; name: string }>;
  onSubjectChange: (v: string) => void;
  onPreviewTextChange: (v: string) => void;
  onSegmentChange?: (v: string) => void;
  onSave: (html: string) => void;
  onClose: () => void;
  onSend?: (html: string) => void;
  sending?: boolean;
  hasContacts?: boolean;
  initialHtml?: string;
}

export default function EmailBuilder({
  subject, previewText, segmentId = '', segments = [],
  onSubjectChange, onPreviewTextChange, onSegmentChange,
  onSave, onClose, onSend, sending = false, hasContacts = true, initialHtml: _initialHtml,
}: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('add');
  const [showPreview, setShowPreview] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  // DnD
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null;

  const addBlock = useCallback((type: EmailBlock['type'], atIndex?: number) => {
    const b = defaultBlock(type);
    setBlocks(prev => {
      if (atIndex !== undefined) {
        const next = [...prev];
        next.splice(atIndex, 0, b);
        return next;
      }
      return [...prev, b];
    });
    setSelectedId(b.id);
    setPanelMode('edit');
    setTimeout(() => {
      const el = canvasRef.current?.querySelector(`[data-block-id="${b.id}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
  }, []);

  const updateBlock = useCallback((updated: EmailBlock) => {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => {
      const next = prev.filter(b => b.id !== id);
      setSelectedId(next[0]?.id ?? null);
      return next;
    });
  }, []);

  const applyTemplate = useCallback((t: Template) => {
    const newBlocks = t.blocks();
    setBlocks(newBlocks);
    setSelectedId(newBlocks[0]?.id ?? null);
    setShowTemplatePicker(false);
  }, []);

  // DnD handlers
  const handleDragStartPalette = useCallback((e: DragEvent<HTMLDivElement>, type: EmailBlock['type']) => {
    e.dataTransfer.effectAllowed = 'copy';
    setDragInfo({ source: 'palette', blockType: type });
  }, []);

  const handleDragStartSection = useCallback((e: DragEvent<HTMLDivElement>, preset: SectionPreset) => {
    e.dataTransfer.effectAllowed = 'copy';
    // Store preset id in dataTransfer as fallback
    e.dataTransfer.setData('text/plain', preset.id);
    // Treat as inserting first block type from preset for simplicity
    setDragInfo({ source: 'palette', blockType: preset.blocks()[0].type });
  }, []);

  const handleDragStartCanvas = useCallback((e: DragEvent<HTMLDivElement>, blockId: string) => {
    e.dataTransfer.effectAllowed = 'move';
    setDragInfo({ source: 'canvas', blockId });
  }, []);

  const handleDrop = useCallback((index: number) => {
    if (!dragInfo) return;
    if (dragInfo.source === 'palette' && dragInfo.blockType) {
      const b = defaultBlock(dragInfo.blockType);
      setBlocks(prev => {
        const next = [...prev];
        next.splice(index, 0, b);
        return next;
      });
      setSelectedId(b.id);
      setPanelMode('edit');
    } else if (dragInfo.source === 'canvas' && dragInfo.blockId) {
      setBlocks(prev => {
        const fromIdx = prev.findIndex(b => b.id === dragInfo.blockId);
        if (fromIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIdx, 1);
        const toIdx = fromIdx < index ? index - 1 : index;
        next.splice(Math.max(0, toIdx), 0, moved);
        return next;
      });
    }
    setDragInfo(null);
    setDropIndex(null);
  }, [dragInfo]);

  // Single canvas-level DnD — calculates drop index from mouse Y so any point on the canvas is a valid target
  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragInfo) return;
    e.dataTransfer.dropEffect = dragInfo.source === 'canvas' ? 'move' : 'copy';
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blockEls = Array.from(canvas.querySelectorAll('[data-block-idx]')) as HTMLElement[];
    let idx = blockEls.length;
    for (let i = 0; i < blockEls.length; i++) {
      const rect = blockEls[i].getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { idx = i; break; }
    }
    setDropIndex(idx);
  }, [dragInfo]);

  const handleCanvasDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (dropIndex !== null) handleDrop(dropIndex);
  }, [dropIndex, handleDrop]);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
  }, []);

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setSelectedId(null);
      setPanelMode('add');
    }
  };

  const selectBlock = (id: string) => {
    setSelectedId(id);
    setPanelMode('edit');
  };

  const html = blocksToHtml(blocks);

  // Sidebar icons
  const sidebarIcons: Array<{ mode: PanelMode; icon: React.ElementType; label: string; disabled?: boolean }> = [
    { mode: 'add',      icon: Plus,     label: 'Add' },
    { mode: 'contents', icon: List,     label: 'Contents' },
    { mode: 'edit',     icon: Settings, label: 'Edit', disabled: !selectedBlock },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f0f2f5]">
      {/* ── Top bar (HubSpot-style) ── */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-[#1f1f1f] px-4 text-white">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-white/10"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2 border-l border-white/10 pl-3 text-slate-300 text-sm">
          <span className="hover:text-white cursor-pointer">File</span>
          <span className="hover:text-white cursor-pointer">Help</span>
        </div>

        {/* Centered title */}
        <div className="flex flex-1 items-center justify-center gap-2">
          <span className="text-sm font-semibold text-white">
            {subject.trim() || 'New email'}
          </span>
          <button className="text-slate-400 hover:text-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Autosaved</span>
          <button
            onClick={() => onSave(html)}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20"
          >
            Save
          </button>
          <button
            onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10"
          >
            <Eye size={13} /> Preview and test
            <ChevronDown size={12} />
          </button>
          {onSend && (
            <button
              onClick={() => setShowChecklist(true)}
              className="rounded-lg bg-[#ff7a59] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#ff6a45]"
            >
              Review and send
            </button>
          )}
        </div>
      </div>

      {/* ── Device toggle bar ── */}
      <div className="flex h-10 shrink-0 items-center justify-center gap-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
          <button className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700">
            <Monitor size={14} />
          </button>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50">
            <Smartphone size={14} />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={segmentId}
            onChange={e => onSegmentChange?.(e.target.value)}
            className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-[#5b6cf9]"
          >
            <option value="">To: All contacts</option>
            {segments.map(s => <option key={s.id} value={s.id}>To: {s.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={subject}
            onChange={e => onSubjectChange(e.target.value)}
            placeholder="Subject line…"
            className="h-7 w-48 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#5b6cf9]"
          />
          <input
            value={previewText}
            onChange={e => onPreviewTextChange(e.target.value)}
            placeholder="Preview text…"
            className="h-7 w-36 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#5b6cf9]"
          />
        </div>
        <button
          onClick={() => setShowTemplatePicker(true)}
          className="h-7 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Templates
        </button>
      </div>

      {/* ── Main 3-column layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: icon strip + context panel */}
        <div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="flex flex-1 overflow-hidden">

            {/* Icon strip */}
            <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-slate-100 bg-slate-50 py-3">
              {sidebarIcons.map(({ mode, icon: Icon, label, disabled }) => (
                <button
                  key={mode}
                  onClick={() => !disabled && setPanelMode(mode)}
                  disabled={disabled}
                  title={label}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${panelMode === mode ? 'bg-[#5b6cf9] text-white' : disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-200'}`}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>

            {/* Panel content */}
            <div className="flex-1 overflow-y-auto">
              {panelMode === 'add' && (
                <AddPanel
                  onAddBlock={type => addBlock(type)}
                  onDragStartPalette={handleDragStartPalette}
                  onDragStartSection={handleDragStartSection}
                />
              )}
              {panelMode === 'contents' && (
                <ContentsPanel
                  blocks={blocks}
                  selectedId={selectedId}
                  subject={subject}
                  previewText={previewText}
                  onSelectBlock={selectBlock}
                />
              )}
              {panelMode === 'edit' && selectedBlock && (
                <EditPanel block={selectedBlock} onChange={updateBlock} />
              )}
              {panelMode === 'edit' && !selectedBlock && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                  <Settings size={24} className="mb-2 opacity-30" />
                  <p className="text-xs text-center">Click a block on the canvas to edit its properties.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Center: canvas */}
        <div
          className="flex flex-1 flex-col overflow-y-auto"
          onClick={handleCanvasClick}
        >
          <div className="mx-auto my-8 w-full max-w-[660px] px-4">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {/* Single drag target covering the whole canvas */}
              <div
                ref={canvasRef}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                onDragLeave={handleCanvasDragLeave}
              >
                {blocks.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-24 transition-colors ${dragInfo ? 'bg-indigo-50' : 'text-slate-400'}`}>
                    {dragInfo ? (
                      <>
                        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#5b6cf9]/10 text-[#5b6cf9]">
                          <Plus size={24} />
                        </div>
                        <p className="text-sm font-semibold text-[#5b6cf9]">Drop to add block</p>
                      </>
                    ) : (
                      <>
                        <Layout size={36} className="mb-4 opacity-30" />
                        <p className="text-sm font-semibold text-slate-600">Start building your email</p>
                        <p className="mt-1 text-xs text-slate-400">Drag modules from the left panel, or use a template to get started.</p>
                        <div className="mt-5 flex gap-2">
                          <button
                            onClick={e => { e.stopPropagation(); setShowTemplatePicker(true); }}
                            className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
                          >
                            Choose Template
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); addBlock('text'); }}
                            className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            Add Text Block
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {dropIndex === 0 && <DropIndicator />}
                    {blocks.map((block, i) => (
                      <div key={block.id} data-block-idx={i} data-block-id={block.id}>
                        <CanvasBlock
                          block={block}
                          selected={selectedId === block.id}
                          isDragging={dragInfo?.source === 'canvas' && dragInfo.blockId === block.id}
                          onSelect={() => selectBlock(block.id)}
                          onDelete={() => deleteBlock(block.id)}
                          onDragStart={e => handleDragStartCanvas(e, block.id)}
                          onDragEnd={() => { setDragInfo(null); setDropIndex(null); }}
                        />
                        {dropIndex === i + 1 && <DropIndicator />}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-slate-400">
              Click a block to edit · Drag to reorder · {blocks.length} block{blocks.length !== 1 ? 's' : ''} · 600px width
            </p>
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showPreview && <PreviewModal html={html} onClose={() => setShowPreview(false)} />}
      {showTemplatePicker && <TemplatePicker onSelect={applyTemplate} onClose={() => setShowTemplatePicker(false)} />}
      {showChecklist && (
        <PreSendChecklist
          blocks={blocks} subject={subject} hasContacts={hasContacts} sending={sending}
          onSend={() => { onSend?.(blocksToHtml(blocks)); setShowChecklist(false); }}
          onClose={() => setShowChecklist(false)}
        />
      )}
    </div>
  );
}
