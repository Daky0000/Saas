import { useState, useRef, useCallback, type DragEvent } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, Eye, Loader2, Minus,
  Monitor, Plus, Smartphone, Trash2, Type, X, Image as ImageIcon,
  Link, Layout, Code, Video as VideoIcon, Share2, List, GripVertical,
  ArrowLeft, Settings, ChevronDown, Mail, Hash, Columns,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right';
type PanelMode = 'add' | 'contents' | 'edit';
type AddTab = 'modules' | 'sections';

interface HeaderBlock   { id: string; type: 'header';  headline: string; subheadline: string; bgColor: string; textColor: string; align: Align; padding: number; }
interface TextBlock     { id: string; type: 'text';    content: string; bgColor: string; textColor: string; fontSize: number; padding: number; lineHeight: number; }
interface ImageBlock    { id: string; type: 'image';   src: string; alt: string; href: string; align: Align; padding: number; }
interface ButtonBlock   { id: string; type: 'button';  text: string; href: string; bgColor: string; textColor: string; align: Align; padding: number; borderRadius: number; fontSize: number; }
interface DividerBlock  { id: string; type: 'divider'; color: string; thickness: number; padding: number; }
interface SpacerBlock   { id: string; type: 'spacer';  height: number; }
interface FooterBlock   { id: string; type: 'footer';  companyName: string; address: string; bgColor: string; textColor: string; }
interface SocialBlock   { id: string; type: 'social';  links: Array<{ platform: string; url: string }>; align: Align; bgColor: string; padding: number; iconColor: string; }
interface HtmlBlock     { id: string; type: 'html';    content: string; padding: number; }
interface VideoBlock    { id: string; type: 'video';   thumbnailUrl: string; videoUrl: string; alt: string; align: Align; padding: number; }

// Leaf blocks (can go inside section columns)
export type LeafBlock =
  | HeaderBlock | TextBlock | ImageBlock | ButtonBlock
  | DividerBlock | SpacerBlock | FooterBlock
  | SocialBlock | HtmlBlock | VideoBlock;

// Section = multi-column row
export interface SectionColumn { id: string; widthFr: number; blocks: LeafBlock[]; }
export interface SectionBlock  { id: string; type: 'section'; layout: string; columns: SectionColumn[]; bgColor: string; padding: number; }

export type EmailBlock = LeafBlock | SectionBlock;

type LeafBlockType = LeafBlock['type'];

interface DragInfo {
  source: 'palette' | 'canvas';
  blockType?: LeafBlockType;
  blockId?: string;
}

// ─── HTML Generation ──────────────────────────────────────────────────────────

const SOCIAL_LABELS: Record<string, string> = {
  facebook: 'Facebook', twitter: 'X / Twitter', instagram: 'Instagram',
  linkedin: 'LinkedIn', youtube: 'YouTube',
};

function leafToHtml(block: LeafBlock): string {
  switch (block.type) {
    case 'header':
      return `<h1 style="margin:0;color:${block.textColor};font-size:28px;font-weight:700;line-height:1.3;font-family:Arial,sans-serif;text-align:${block.align};padding:${block.padding}px;background-color:${block.bgColor};">${block.headline}</h1>${block.subheadline ? `<p style="margin:8px 0 0;color:${block.textColor};font-size:16px;opacity:.85;font-family:Arial,sans-serif;text-align:${block.align};padding:0 ${block.padding}px ${block.padding}px;">${block.subheadline}</p>` : ''}`;
    case 'text':
      return `<div style="color:${block.textColor};font-size:${block.fontSize}px;line-height:${block.lineHeight};font-family:Arial,sans-serif;padding:${block.padding}px;background-color:${block.bgColor};">${block.content}</div>`;
    case 'image': {
      const img = `<img src="${block.src}" alt="${block.alt}" style="max-width:100%;height:auto;display:block;" />`;
      return `<div style="padding:${block.padding}px;text-align:${block.align};">${block.href ? `<a href="${block.href}" style="text-decoration:none;">${img}</a>` : img}</div>`;
    }
    case 'button':
      return `<div style="padding:${block.padding}px;text-align:${block.align};"><a href="${block.href}" style="display:inline-block;background-color:${block.bgColor};color:${block.textColor};font-size:${block.fontSize}px;font-weight:600;font-family:Arial,sans-serif;text-decoration:none;padding:14px 32px;border-radius:${block.borderRadius}px;">${block.text}</a></div>`;
    case 'divider':
      return `<div style="padding:${block.padding}px 0;"><hr style="border:none;border-top:${block.thickness}px solid ${block.color};margin:0;" /></div>`;
    case 'spacer':
      return `<div style="height:${block.height}px;"></div>`;
    case 'footer':
      return `<div style="padding:28px 32px;background-color:${block.bgColor};text-align:center;"><p style="margin:0;color:${block.textColor};font-size:13px;font-family:Arial,sans-serif;opacity:.8;">${block.companyName}</p>${block.address ? `<p style="margin:4px 0 0;color:${block.textColor};font-size:12px;font-family:Arial,sans-serif;opacity:.6;">${block.address}</p>` : ''}<p style="margin:14px 0 0;"><a href="{{unsubscribe_url}}" style="color:${block.textColor};font-size:12px;font-family:Arial,sans-serif;opacity:.65;text-decoration:underline;">Unsubscribe</a></p></div>`;
    case 'social':
      return `<div style="padding:${block.padding}px;background-color:${block.bgColor};text-align:${block.align};">${block.links.map(l => `<a href="${l.url}" style="display:inline-block;margin:0 8px;color:${block.iconColor};font-size:13px;font-family:Arial,sans-serif;text-decoration:none;font-weight:600;">${SOCIAL_LABELS[l.platform] || l.platform}</a>`).join('')}</div>`;
    case 'html':
      return `<div style="padding:${block.padding}px;">${block.content}</div>`;
    case 'video': {
      const inner = block.thumbnailUrl
        ? `<img src="${block.thumbnailUrl}" alt="${block.alt}" style="max-width:100%;height:auto;display:block;" />`
        : `<div style="background:#1e293b;padding:40px;color:#fff;font-family:Arial,sans-serif;font-size:18px;text-align:center;border-radius:8px;">&#9654; Watch Video</div>`;
      return `<div style="padding:${block.padding}px;text-align:${block.align};"><a href="${block.videoUrl}" style="text-decoration:none;">${inner}</a></div>`;
    }
  }
}

function blockToHtml(block: EmailBlock): string {
  if (block.type === 'section') {
    const total = block.columns.reduce((s, c) => s + c.widthFr, 0);
    const cols = block.columns.map(col => {
      const pct = Math.round((col.widthFr / total) * 100);
      const inner = col.blocks.map(leafToHtml).join('');
      return `<td width="${pct}%" valign="top" style="padding:0 6px;">${inner || '&nbsp;'}</td>`;
    }).join('');
    return `<tr><td bgcolor="${block.bgColor}" style="padding:${block.padding}px;background-color:${block.bgColor};">
<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cols}</tr></table>
</td></tr>`;
  }
  // Wrap leaf block in a table row
  return `<tr><td>${leafToHtml(block)}</td></tr>`;
}

export function blocksToHtml(blocks: EmailBlock[]): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<style>body{margin:0;padding:0;background:#f4f4f7;}table{border-collapse:collapse;}img{border:0;display:block;max-width:100%;}@media(max-width:600px){.ec{width:100%!important;}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;">
<center><table width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="padding:24px 16px;">
<table class="ec" width="600" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
${blocks.map(blockToHtml).join('\n')}
</table></td></tr></table></center>
</body></html>`;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

let _id = 1;
function uid() { return `b${_id++}`; }

function defaultLeaf(type: LeafBlockType): LeafBlock {
  switch (type) {
    case 'header':  return { id: uid(), type: 'header', headline: 'Your Headline Here', subheadline: 'A short supporting tagline', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 40 };
    case 'text':    return { id: uid(), type: 'text', content: 'Write your email body here. You can use <strong>bold</strong>, <em>italic</em>, or <a href="#">links</a>.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.7 };
    case 'image':   return { id: uid(), type: 'image', src: '', alt: '', href: '', align: 'center', padding: 24 };
    case 'button':  return { id: uid(), type: 'button', text: 'Get Started', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 };
    case 'divider': return { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 16 };
    case 'spacer':  return { id: uid(), type: 'spacer', height: 24 };
    case 'footer':  return { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St, City', bgColor: '#f9fafb', textColor: '#6b7280' };
    case 'social':  return { id: uid(), type: 'social', links: [{ platform: 'facebook', url: '#' }, { platform: 'twitter', url: '#' }, { platform: 'instagram', url: '#' }], align: 'center', bgColor: '#ffffff', padding: 24, iconColor: '#5b6cf9' };
    case 'html':    return { id: uid(), type: 'html', content: '<p style="font-family:Arial,sans-serif;font-size:14px;color:#374151;">Custom HTML here</p>', padding: 24 };
    case 'video':   return { id: uid(), type: 'video', thumbnailUrl: '', videoUrl: '#', alt: 'Watch video', align: 'center', padding: 24 };
  }
}

function makeSection(fractions: number[]): SectionBlock {
  return {
    id: uid(), type: 'section',
    layout: fractions.join(':'),
    columns: fractions.map(fr => ({ id: uid(), widthFr: fr, blocks: [] })),
    bgColor: '#ffffff', padding: 16,
  };
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
      { id: uid(), type: 'text', content: '<strong>Hi {{first_name}},</strong><br/><br/>Here\'s what\'s been happening this month.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'button', text: 'Read More', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 15 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'promotional', name: 'Promotional', emoji: '🛍️', description: 'Sales & offers',
    blocks: () => [
      { id: uid(), type: 'header', headline: '🔥 Limited Time Offer', subheadline: 'Don\'t miss out', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'button', text: 'Shop Now', href: '#', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 10, fontSize: 17 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
];

// ─── Personalization tokens ───────────────────────────────────────────────────

const TOKENS = [
  { label: 'First Name', value: '{{first_name}}' },
  { label: 'Last Name',  value: '{{last_name}}' },
  { label: 'Email',      value: '{{email}}' },
  { label: 'Company',    value: '{{company}}' },
];

// ─── Section presets ──────────────────────────────────────────────────────────

interface SectionPreset { id: string; name: string; fractions: number[]; preview: string }

const SECTION_PRESETS: SectionPreset[] = [
  { id: 's1',   name: '1 Column',   fractions: [1],          preview: '1' },
  { id: 's2',   name: '2 Columns',  fractions: [1, 1],       preview: '2' },
  { id: 's3',   name: '3 Columns',  fractions: [1, 1, 1],    preview: '3' },
  { id: 's13',  name: '1/3 : 2/3', fractions: [1, 2],       preview: '1/3:2/3' },
  { id: 's31',  name: '2/3 : 1/3', fractions: [2, 1],       preview: '2/3:1/3' },
  { id: 's4',   name: '4 Columns',  fractions: [1, 1, 1, 1], preview: '4' },
];

// ─── Gap zone (between top-level blocks while dragging) ───────────────────────

function GapZone({ isActive }: { isActive: boolean }) {
  return (
    <div className={`mx-3 my-1 flex h-8 items-center justify-center rounded-lg border-2 border-dashed transition-colors ${isActive ? 'border-[#5b6cf9] bg-indigo-50' : 'border-slate-200 bg-transparent'}`}>
      {isActive && <span className="flex items-center gap-1 text-xs font-semibold text-[#5b6cf9]"><Plus size={11} /> Drop here</span>}
    </div>
  );
}

// ─── Section preview icon ─────────────────────────────────────────────────────

function SectionPreviewIcon({ preview }: { preview: string }) {
  const map: Record<string, React.ReactNode> = {
    '1':      <div className="flex gap-1 p-1"><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /></div>,
    '2':      <div className="flex gap-1 p-1"><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /></div>,
    '3':      <div className="flex gap-0.5 p-1"><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /></div>,
    '1/3:2/3':<div className="flex gap-1 p-1"><div className="h-10 w-[30%] rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /></div>,
    '2/3:1/3':<div className="flex gap-1 p-1"><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 w-[30%] rounded border-2 border-slate-400 bg-slate-200" /></div>,
    '4':      <div className="flex gap-0.5 p-1"><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /><div className="h-10 flex-1 rounded border-2 border-slate-400 bg-slate-200" /></div>,
  };
  return <div className="text-slate-500">{map[preview]}</div>;
}

// ─── Column cell (inside a section) ──────────────────────────────────────────

function ColumnCell({
  col, isSelected, isDragOver, isDraggingActive,
  onClick, onDragOver, onDragLeave, onDrop,
}: {
  col: SectionColumn; isSelected: boolean; isDragOver: boolean; isDraggingActive: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const outline = isSelected
    ? 'border-[#5b6cf9] bg-indigo-50/40'
    : isDragOver
    ? 'border-[#5b6cf9] bg-indigo-50'
    : isDraggingActive
    ? 'border-slate-300 bg-slate-50/60'
    : 'border-slate-200 hover:border-slate-400';

  return (
    <div
      className={`relative min-h-[80px] flex-1 cursor-pointer rounded-lg border-2 border-dashed transition-all ${outline}`}
      style={{ flexBasis: 0, flexGrow: col.widthFr }}
      onClick={onClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {col.blocks.length === 0 ? (
        <div className={`flex h-full min-h-[80px] flex-col items-center justify-center gap-1 text-sm font-medium ${isDragOver ? 'text-[#5b6cf9]' : 'text-slate-400'}`}>
          {isDragOver ? <><Plus size={16} className="text-[#5b6cf9]" /> Drop here</> : 'Drop content here'}
        </div>
      ) : (
        <div className="p-1">
          {col.blocks.map(b => (
            <LeafPreview key={b.id} block={b} compact />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Leaf block compact preview (inside column cells) ─────────────────────────

function LeafPreview({ block, compact }: { block: LeafBlock; compact?: boolean }) {
  const p = compact ? 'p-2' : 'p-3';
  switch (block.type) {
    case 'header':
      return <div className={`${p} text-center`} style={{ backgroundColor: block.bgColor }}><div style={{ color: block.textColor, fontWeight: 700, fontSize: 14, fontFamily: 'Arial' }}>{block.headline || <em>Headline</em>}</div></div>;
    case 'text':
      return <div className={`${p}`} style={{ backgroundColor: block.bgColor }}><div style={{ color: block.textColor, fontSize: 12, fontFamily: 'Arial' }} dangerouslySetInnerHTML={{ __html: block.content.slice(0, 80) + (block.content.length > 80 ? '…' : '') }} /></div>;
    case 'image':
      return block.src
        ? <div className={`${p} text-center`}><img src={block.src} alt={block.alt} className="max-w-full h-auto inline-block" style={{ maxHeight: 60 }} /></div>
        : <div className={`${p} flex items-center justify-center rounded bg-slate-100 text-slate-400`} style={{ minHeight: 40 }}><ImageIcon size={16} /></div>;
    case 'button':
      return <div className={`${p} text-center`}><span style={{ background: block.bgColor, color: block.textColor, borderRadius: block.borderRadius, padding: '6px 14px', fontSize: 12, fontFamily: 'Arial', display: 'inline-block' }}>{block.text}</span></div>;
    case 'divider':
      return <div className="my-1 px-2"><hr style={{ border: 'none', borderTop: `${block.thickness}px solid ${block.color}` }} /></div>;
    case 'spacer':
      return <div className="flex items-center justify-center" style={{ height: Math.min(block.height, 20) }}><span className="text-[9px] text-slate-300">{block.height}px</span></div>;
    case 'footer':
      return <div className={`${p} text-center`} style={{ backgroundColor: block.bgColor }}><div style={{ color: block.textColor, fontSize: 10 }}>{block.companyName}</div></div>;
    case 'social':
      return <div className={`${p} flex justify-center gap-1`}>{block.links.slice(0, 3).map((l, i) => <span key={i} className="text-[9px] font-semibold" style={{ color: block.iconColor }}>{l.platform}</span>)}</div>;
    case 'html':
      return <div className={`${p} rounded bg-slate-100`}><Code size={12} className="text-slate-400 inline mr-1" /><span className="text-[10px] text-slate-500">HTML</span></div>;
    case 'video':
      return <div className={`${p} flex items-center justify-center rounded bg-slate-100 text-slate-400`} style={{ minHeight: 40 }}><VideoIcon size={16} /></div>;
  }
}

// ─── Section canvas block ─────────────────────────────────────────────────────

function SectionView({
  section, isSelected, selectedColId, isDragging, isDraggingActive, dragOverColId,
  onSelectSection, onSelectCol,
  onDragOver, onDragLeave, onDropToCol,
  onDragStartSection, onDragEndSection, onDelete,
}: {
  section: SectionBlock; isSelected: boolean; selectedColId: string | null;
  isDragging: boolean; isDraggingActive: boolean; dragOverColId: string | null;
  onSelectSection: (e: React.MouseEvent) => void;
  onSelectCol: (colId: string, e: React.MouseEvent) => void;
  onDragOver: (colId: string, e: DragEvent<HTMLDivElement>) => void;
  onDragLeave: (e: DragEvent<HTMLDivElement>) => void;
  onDropToCol: (colId: string, e: DragEvent<HTMLDivElement>) => void;
  onDragStartSection: (e: DragEvent<HTMLDivElement>) => void;
  onDragEndSection: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const outline = isSelected
    ? 'outline outline-2 outline-[#5b6cf9] outline-offset-[-2px]'
    : 'hover:outline hover:outline-1 hover:outline-slate-300 hover:outline-offset-[-1px]';

  return (
    <div
      data-canvas-block
      className={`group relative cursor-pointer ${outline} ${isDragging ? 'opacity-40' : ''}`}
      style={{ backgroundColor: section.bgColor, padding: section.padding }}
      onClick={onSelectSection}
      draggable
      onDragStart={onDragStartSection}
      onDragEnd={onDragEndSection}
    >
      {/* Drag handle */}
      <div
        className={`absolute left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onMouseDown={e => e.stopPropagation()}
      >
        <GripVertical size={14} />
      </div>
      {/* Delete */}
      {isSelected && (
        <div className="absolute right-2 top-2 z-10 flex gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={onDelete} className="flex h-6 w-6 items-center justify-center rounded bg-red-50 text-red-500 shadow hover:bg-red-100">
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {/* Columns */}
      <div className="flex gap-3 pl-4">
        {section.columns.map(col => (
          <ColumnCell
            key={col.id}
            col={col}
            isSelected={selectedColId === col.id}
            isDragOver={dragOverColId === col.id}
            isDraggingActive={isDraggingActive}
            onClick={e => onSelectCol(col.id, e)}
            onDragOver={e => { e.stopPropagation(); onDragOver(col.id, e); }}
            onDragLeave={e => { e.stopPropagation(); onDragLeave(e); }}
            onDrop={e => { e.stopPropagation(); onDropToCol(col.id, e); }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Leaf canvas block ────────────────────────────────────────────────────────

function LeafCanvasBlock({
  block, selected, isDragging,
  onSelect, onDelete, onDragStart, onDragEnd,
}: {
  block: LeafBlock; selected: boolean; isDragging: boolean;
  onSelect: () => void; onDelete: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}) {
  const ring = selected
    ? 'outline outline-2 outline-[#5b6cf9] outline-offset-[-2px]'
    : 'hover:outline hover:outline-1 hover:outline-slate-300 hover:outline-offset-[-1px]';

  const toolbar = selected && (
    <div className="absolute right-2 top-2 z-10 flex gap-1" onClick={e => e.stopPropagation()}>
      <button onClick={onDelete} className="flex h-6 w-6 items-center justify-center rounded bg-red-50 text-red-500 shadow hover:bg-red-100">
        <Trash2 size={11} />
      </button>
    </div>
  );

  const wrap = (content: React.ReactNode) => (
    <div
      data-canvas-block
      className={`group relative cursor-pointer select-none transition-opacity ${ring} ${isDragging ? 'opacity-40' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className={`absolute left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab rounded p-0.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        onMouseDown={e => e.stopPropagation()}>
        <GripVertical size={14} />
      </div>
      {toolbar}
      {content}
    </div>
  );

  switch (block.type) {
    case 'header': return wrap(
      <div style={{ backgroundColor: block.bgColor, padding: block.padding, textAlign: block.align }}>
        <div style={{ color: block.textColor, fontSize: 26, fontWeight: 700, lineHeight: 1.3, fontFamily: 'Arial' }}>{block.headline || <em style={{ opacity: .4 }}>Headline…</em>}</div>
        {block.subheadline && <div style={{ color: block.textColor, fontSize: 16, marginTop: 8, opacity: .85, fontFamily: 'Arial' }}>{block.subheadline}</div>}
      </div>
    );
    case 'text': return wrap(
      <div style={{ backgroundColor: block.bgColor, padding: block.padding }}>
        <div style={{ color: block.textColor, fontSize: block.fontSize, lineHeight: block.lineHeight, fontFamily: 'Arial' }} dangerouslySetInnerHTML={{ __html: block.content || '<em style="opacity:.4">Text content…</em>' }} />
      </div>
    );
    case 'image': return wrap(
      <div style={{ padding: block.padding, textAlign: block.align }}>
        {block.src
          ? <img src={block.src} alt={block.alt} style={{ maxWidth: '100%', height: 'auto', display: 'inline-block' }} />
          : <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-10 text-slate-400"><ImageIcon size={28} /><span className="text-sm">Enter image URL in the properties panel</span></div>}
      </div>
    );
    case 'button': return wrap(
      <div style={{ padding: block.padding, textAlign: block.align }}>
        <span style={{ display: 'inline-block', backgroundColor: block.bgColor, color: block.textColor, fontSize: block.fontSize, fontWeight: 600, padding: '14px 32px', borderRadius: block.borderRadius, fontFamily: 'Arial', cursor: 'default' }}>{block.text || 'Button Text'}</span>
      </div>
    );
    case 'divider': return wrap(<div style={{ padding: `${block.padding}px 32px` }}><hr style={{ border: 'none', borderTop: `${block.thickness}px solid ${block.color}`, margin: 0 }} /></div>);
    case 'spacer':  return wrap(<div style={{ height: block.height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="text-[10px] font-mono text-slate-300">{block.height}px spacer</span></div>);
    case 'footer':  return wrap(
      <div style={{ backgroundColor: block.bgColor, padding: '24px 32px', textAlign: 'center' }}>
        <div style={{ color: block.textColor, fontSize: 13, fontFamily: 'Arial', opacity: .8 }}>{block.companyName}</div>
        {block.address && <div style={{ color: block.textColor, fontSize: 12, marginTop: 4, opacity: .6, fontFamily: 'Arial' }}>{block.address}</div>}
        <div style={{ marginTop: 12 }}><span style={{ color: block.textColor, fontSize: 12, opacity: .65, textDecoration: 'underline', cursor: 'default' }}>Unsubscribe</span></div>
      </div>
    );
    case 'social': return wrap(
      <div style={{ backgroundColor: block.bgColor, padding: block.padding, textAlign: block.align }}>
        <div className="flex flex-wrap items-center gap-3" style={{ justifyContent: block.align === 'center' ? 'center' : block.align === 'right' ? 'flex-end' : 'flex-start' }}>
          {block.links.map((l, i) => <span key={i} style={{ color: block.iconColor, fontSize: 13, fontFamily: 'Arial', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Share2 size={14} />{SOCIAL_LABELS[l.platform] || l.platform}</span>)}
        </div>
      </div>
    );
    case 'html': return wrap(
      <div style={{ padding: block.padding }}>
        <div className="rounded border border-dashed border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400"><Code size={11} /> HTML Block</div>
          <pre className="overflow-x-auto text-[11px] text-slate-500 whitespace-pre-wrap">{block.content.slice(0, 120)}{block.content.length > 120 ? '…' : ''}</pre>
        </div>
      </div>
    );
    case 'video': return wrap(
      <div style={{ padding: block.padding, textAlign: block.align }}>
        {block.thumbnailUrl
          ? <div className="relative inline-block"><img src={block.thumbnailUrl} alt={block.alt} style={{ maxWidth: '100%', display: 'block' }} /><div className="absolute inset-0 flex items-center justify-center bg-black/20"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 shadow-lg"><VideoIcon size={20} /></div></div></div>
          : <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-10 text-slate-400"><VideoIcon size={28} /><span className="text-sm">Enter thumbnail URL in the properties panel</span></div>}
      </div>
    );
  }
}

// ─── Edit Panel ───────────────────────────────────────────────────────────────

function EditPanel({
  block, onChange, selectedColId, onColModuleDelete, onColModuleAdd,
  onUpdateColModule,
}: {
  block: EmailBlock;
  onChange: (b: EmailBlock) => void;
  selectedColId: string | null;
  onColModuleDelete: (colId: string, moduleId: string) => void;
  onColModuleAdd: (colId: string, type: LeafBlockType) => void;
  onUpdateColModule: (colId: string, module: LeafBlock) => void;
}) {
  // ── Section column editor ──
  if (block.type === 'section' && selectedColId) {
    const col = block.columns.find(c => c.id === selectedColId);
    if (!col) return null;
    return (
      <div>
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#5b6cf9]" /><span className="text-xs font-bold text-slate-700">Edit Column</span></div>
        </div>
        <div className="p-4 space-y-4">
          {col.blocks.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
              Drop a module onto this column or add one below
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Modules in this column</label>
              {col.blocks.map(m => (
                <div key={m.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <span className="flex-1 text-xs font-medium text-slate-700 capitalize">{m.type}</span>
                  <button onClick={() => onColModuleDelete(col.id, m.id)} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Add module to column</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['text', 'image', 'button', 'divider', 'social', 'html'] as LeafBlockType[]).map(t => (
                <button key={t} onClick={() => onColModuleAdd(col.id, t)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#5b6cf9] hover:bg-indigo-50 capitalize">
                  <Plus size={10} /> {t}
                </button>
              ))}
            </div>
          </div>
          {/* Edit first module in col if any */}
          {col.blocks.length > 0 && (
            <div className="border-t border-slate-100 pt-3">
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Edit top module</label>
              <LeafEditFields block={col.blocks[0]} onChange={m => onUpdateColModule(col.id, m)} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Section container editor ──
  if (block.type === 'section') {
    return (
      <div>
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#5b6cf9]" /><span className="text-xs font-bold text-slate-700">Edit Section</span></div>
        </div>
        <div className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Background Color</label>
            <div className="flex items-center gap-2">
              <input type="color" value={block.bgColor} onChange={e => onChange({ ...block, bgColor: e.target.value })} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5" />
              <input value={block.bgColor} onChange={e => onChange({ ...block, bgColor: e.target.value })} className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-[#5b6cf9]" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Padding (px)</label>
            <input type="number" min={0} max={80} value={block.padding} onChange={e => onChange({ ...block, padding: Number(e.target.value) })} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />
          </div>
          <p className="rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-500">Click an individual column to add or edit its content.</p>
        </div>
      </div>
    );
  }

  // ── Leaf block editor ──
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
        <div className="flex items-center gap-2"><div className="h-2 w-2 rounded-full bg-[#5b6cf9]" /><span className="text-xs font-bold text-slate-700 capitalize">Edit {block.type}</span></div>
      </div>
      <div className="p-4">
        <LeafEditFields block={block} onChange={onChange as (b: LeafBlock) => void} />
      </div>
    </div>
  );
}

function LeafEditFields({ block, onChange }: { block: LeafBlock; onChange: (b: LeafBlock) => void }) {
  const set = <K extends string>(key: K, value: unknown) => onChange({ ...block, [key]: value } as LeafBlock);

  const field = (label: string, children: React.ReactNode) => (
    <div className="space-y-1.5">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</label>
      {children}
    </div>
  );
  const inp = (key: string, value: string, placeholder?: string) => (
    <input value={value} placeholder={placeholder} onChange={e => set(key, e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />
  );
  const num = (key: string, value: number, min = 0, max = 999) => (
    <input type="number" min={min} max={max} value={value} onChange={e => set(key, Number(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />
  );
  const clr = (key: string, value: string) => (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => set(key, e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-200 p-0.5" />
      <input value={value} onChange={e => set(key, e.target.value)} className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-[#5b6cf9]" />
    </div>
  );
  const aln = (key: string, value: Align) => (
    <div className="flex overflow-hidden rounded-lg border border-slate-200">
      {(['left', 'center', 'right'] as Align[]).map(a => (
        <button key={a} onClick={() => set(key, a)} className={`flex flex-1 items-center justify-center py-2 text-xs ${value === a ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
          {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
        </button>
      ))}
    </div>
  );
  const ta = (key: string, value: string, rows = 5, placeholder?: string) => (
    <textarea value={value} rows={rows} placeholder={placeholder} onChange={e => set(key, e.target.value)} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />
  );

  return (
    <div className="space-y-4">
      {block.type === 'header' && <>
        {field('Headline', inp('headline', block.headline, 'Headline…'))}
        {field('Subheadline', inp('subheadline', block.subheadline, 'Subheadline…'))}
        {field('Background', clr('bgColor', block.bgColor))}
        {field('Text Color', clr('textColor', block.textColor))}
        {field('Alignment', aln('align', block.align))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
      </>}
      {block.type === 'text' && <>
        {field('Content (HTML)', ta('content', block.content, 6, 'Your text…'))}
        <div className="rounded-lg bg-blue-50 p-2.5">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-500">Personalization</p>
          <div className="flex flex-wrap gap-1">
            {TOKENS.map(t => (
              <button key={t.value} onClick={() => set('content', block.content + t.value)} className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-200">{t.value}</button>
            ))}
          </div>
        </div>
        {field('Background', clr('bgColor', block.bgColor))}
        {field('Text Color', clr('textColor', block.textColor))}
        {field('Font Size (px)', num('fontSize', block.fontSize, 10, 48))}
        {field('Line Height', <input type="number" min={1} max={3} step={0.1} value={block.lineHeight} onChange={e => set('lineHeight', parseFloat(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#5b6cf9]" />)}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
      </>}
      {block.type === 'image' && <>
        {field('Image URL', inp('src', block.src, 'https://…'))}
        {field('Alt Text', inp('alt', block.alt, 'Description'))}
        {field('Link URL', inp('href', block.href, 'https://…'))}
        {field('Alignment', aln('align', block.align))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
      </>}
      {block.type === 'button' && <>
        {field('Button Text', inp('text', block.text, 'Click here…'))}
        {field('Button URL', inp('href', block.href, 'https://…'))}
        {field('Background', clr('bgColor', block.bgColor))}
        {field('Text Color', clr('textColor', block.textColor))}
        {field('Alignment', aln('align', block.align))}
        {field('Font Size (px)', num('fontSize', block.fontSize, 10, 36))}
        {field('Border Radius (px)', num('borderRadius', block.borderRadius, 0, 50))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
      </>}
      {block.type === 'divider' && <>
        {field('Color', clr('color', block.color))}
        {field('Thickness (px)', num('thickness', block.thickness, 1, 10))}
        {field('Padding (px)', num('padding', block.padding, 0, 60))}
      </>}
      {block.type === 'spacer' && <>{field('Height (px)', num('height', block.height, 4, 200))}</>}
      {block.type === 'footer' && <>
        {field('Company Name', inp('companyName', block.companyName))}
        {field('Address', inp('address', block.address))}
        {field('Background', clr('bgColor', block.bgColor))}
        {field('Text Color', clr('textColor', block.textColor))}
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">Unsubscribe link auto-added via {'{{unsubscribe_url}}'}.</p>
      </>}
      {block.type === 'social' && <>
        {field('Alignment', aln('align', block.align))}
        {field('Icon Color', clr('iconColor', block.iconColor))}
        {field('Background', clr('bgColor', block.bgColor))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
        <div className="space-y-2">
          <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">Links</label>
          {block.links.map((l, i) => (
            <div key={i} className="flex items-center gap-2">
              <select value={l.platform} onChange={e => { const lnks = [...block.links]; lnks[i] = { ...lnks[i], platform: e.target.value }; set('links', lnks); }} className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none">
                {['facebook','twitter','instagram','linkedin','youtube'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={l.url} onChange={e => { const lnks = [...block.links]; lnks[i] = { ...lnks[i], url: e.target.value }; set('links', lnks); }} placeholder="URL" className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none" />
              <button onClick={() => set('links', block.links.filter((_, j) => j !== i))} className="text-slate-300 hover:text-red-500"><X size={13} /></button>
            </div>
          ))}
          <button onClick={() => set('links', [...block.links, { platform: 'facebook', url: '#' }])} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-200 py-1.5 text-xs text-slate-500 hover:border-[#5b6cf9] hover:text-[#5b6cf9]"><Plus size={11} /> Add Platform</button>
        </div>
      </>}
      {block.type === 'html' && <>
        {field('HTML Content', ta('content', block.content, 8))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">Use inline styles only — email clients don't support external CSS.</p>
      </>}
      {block.type === 'video' && <>
        {field('Thumbnail URL', inp('thumbnailUrl', block.thumbnailUrl, 'https://…'))}
        {field('Video URL', inp('videoUrl', block.videoUrl, 'https://…'))}
        {field('Alt Text', inp('alt', block.alt))}
        {field('Alignment', aln('align', block.align))}
        {field('Padding (px)', num('padding', block.padding, 0, 120))}
      </>}
    </div>
  );
}

// ─── Add Panel ────────────────────────────────────────────────────────────────

const MODULE_PALETTE: Array<{ type: LeafBlockType; label: string; icon: React.ElementType }> = [
  { type: 'text',    label: 'Text',    icon: Type },
  { type: 'button',  label: 'Button',  icon: Link },
  { type: 'social',  label: 'Social',  icon: Share2 },
  { type: 'html',    label: 'HTML',    icon: Code },
  { type: 'image',   label: 'Image',   icon: ImageIcon },
  { type: 'video',   label: 'Video',   icon: VideoIcon },
  { type: 'divider', label: 'Divider', icon: Minus },
  { type: 'header',  label: 'Header',  icon: Hash },
  { type: 'footer',  label: 'Footer',  icon: Mail },
];

function AddPanel({
  onAddLeaf, onAddSection, onDragStartLeaf, onDragStartSection,
}: {
  onAddLeaf: (type: LeafBlockType) => void;
  onAddSection: (preset: SectionPreset) => void;
  onDragStartLeaf: (e: DragEvent<HTMLDivElement>, type: LeafBlockType) => void;
  onDragStartSection: (e: DragEvent<HTMLDivElement>, preset: SectionPreset) => void;
}) {
  const [tab, setTab] = useState<AddTab>('modules');
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3">
        <span className="text-xs font-bold text-slate-700">Add</span>
      </div>
      <div className="flex border-b border-slate-100">
        <button onClick={() => setTab('modules')} className={`flex-1 py-2.5 text-xs font-semibold ${tab === 'modules' ? 'border-b-2 border-[#5b6cf9] text-[#5b6cf9]' : 'text-slate-500 hover:text-slate-700'}`}>Modules</button>
        <button onClick={() => setTab('sections')} className={`flex-1 py-2.5 text-xs font-semibold ${tab === 'sections' ? 'border-b-2 border-[#5b6cf9] text-[#5b6cf9]' : 'text-slate-500 hover:text-slate-700'}`}>Sections</button>
      </div>
      {tab === 'modules' && (
        <div className="p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">All default modules ({MODULE_PALETTE.length})</div>
          <div className="grid grid-cols-2 gap-2">
            {MODULE_PALETTE.map(({ type, label, icon: Icon }) => (
              <div key={type} draggable onDragStart={e => onDragStartLeaf(e, type)} onClick={() => onAddLeaf(type)}
                className="flex cursor-grab flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 hover:border-[#5b6cf9] hover:bg-indigo-50 active:cursor-grabbing transition-colors">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500"><Icon size={15} /></div>
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
              <div key={preset.id} draggable onDragStart={e => onDragStartSection(e, preset)} onClick={() => onAddSection(preset)}
                className="flex cursor-grab flex-col gap-2 rounded-xl border border-slate-200 bg-white p-2 hover:border-[#5b6cf9] hover:bg-indigo-50 active:cursor-grabbing transition-colors">
                <SectionPreviewIcon preview={preset.preview} />
                <span className="text-[11px] font-semibold text-slate-600 text-center">{preset.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Contents Panel ───────────────────────────────────────────────────────────

function ContentsPanel({ blocks, selectedId, subject, previewText, onSelect }: {
  blocks: EmailBlock[]; selectedId: string | null; subject: string; previewText: string;
  onSelect: (id: string) => void;
}) {
  const ICON: Partial<Record<string, React.ElementType>> = {
    header: Hash, text: Type, image: ImageIcon, button: Link, divider: Minus,
    spacer: Layout, footer: Mail, social: Share2, html: Code, video: VideoIcon, section: Columns,
  };
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-3"><span className="text-xs font-bold text-slate-700">Contents</span></div>
      <div className="px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Inbox content</div>
        {[{ label: 'Subject line', value: subject || '—' }, { label: 'Preview text', value: previewText || '—' }].map(r => (
          <div key={r.label} className="flex items-start gap-2 py-1.5">
            <Mail size={12} className="mt-0.5 shrink-0 text-slate-400" />
            <div><div className="text-[11px] font-semibold text-slate-500">{r.label}</div><div className="text-xs text-slate-700 truncate max-w-[160px]">{r.value}</div></div>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Email body</span>
          <span className="text-[10px] text-slate-400">{blocks.length} items</span>
        </div>
        <div className="space-y-0.5">
          {blocks.map((block, i) => {
            const Icon = ICON[block.type] || Layout;
            const label = block.type === 'section'
              ? `Section (${block.columns.length} col)`
              : block.type === 'header' ? (block as HeaderBlock).headline?.slice(0, 24) || 'Header'
              : block.type === 'button' ? (block as ButtonBlock).text || 'Button'
              : block.type.charAt(0).toUpperCase() + block.type.slice(1);
            return (
              <button key={block.id} onClick={() => onSelect(block.id)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${selectedId === block.id ? 'bg-indigo-50 text-[#5b6cf9]' : 'text-slate-600 hover:bg-slate-50'}`}>
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
            <button onClick={() => setDevice('desktop')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${device === 'desktop' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}><Monitor size={13} /> Desktop</button>
            <button onClick={() => setDevice('mobile')} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${device === 'mobile' ? 'bg-slate-600 text-white' : 'text-slate-400 hover:text-white'}`}><Smartphone size={13} /> Mobile</button>
          </div>
        </div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white"><X size={18} /></button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-slate-800 p-8">
        <div className="overflow-hidden rounded-lg shadow-2xl" style={{ width: device === 'mobile' ? 390 : 700, background: '#f4f4f7' }}>
          <iframe srcDoc={html} title="Email Preview" className="block w-full border-0" style={{ height: device === 'mobile' ? 720 : 600, width: device === 'mobile' ? 390 : 700 }} sandbox="allow-same-origin" />
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
          <div><h2 className="text-lg font-black text-slate-950">Choose a Template</h2><p className="mt-0.5 text-sm text-slate-500">Start with a pre-built layout.</p></div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3">
          {TEMPLATES.map(t => (
            <button key={t.id} onClick={() => onSelect(t)} className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-[#5b6cf9] hover:bg-indigo-50 transition-all">
              <span className="text-2xl">{t.emoji}</span>
              <div><div className="text-sm font-bold text-slate-900">{t.name}</div><div className="mt-0.5 text-xs text-slate-500">{t.description}</div></div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Pre-send Checklist ───────────────────────────────────────────────────────

function PreSendChecklist({ blocks, subject, hasContacts, onSend, onClose, sending }: {
  blocks: EmailBlock[]; subject: string; hasContacts: boolean;
  onSend: () => void; onClose: () => void; sending: boolean;
}) {
  const checks = [
    { label: 'Subject line is set', ok: subject.trim().length > 0, required: true },
    { label: 'Email has content', ok: blocks.length > 0, required: true },
    { label: 'Recipients selected', ok: hasContacts, required: true },
    { label: 'Footer block included', ok: blocks.some(b => b.type === 'footer'), required: false },
  ];
  const errors = checks.filter(c => c.required && !c.ok);
  const canSend = errors.length === 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <h2 className="text-lg font-black text-slate-950">Review and send</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="space-y-2 p-6">
          {checks.map((c, i) => (
            <div key={i} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${c.ok ? 'bg-emerald-50' : c.required ? 'bg-red-50' : 'bg-amber-50'}`}>
              <span className={`text-base ${c.ok ? 'text-emerald-500' : c.required ? 'text-red-500' : 'text-amber-500'}`}>{c.ok ? '✓' : c.required ? '✗' : '⚠'}</span>
              <span className={`text-sm font-medium ${c.ok ? 'text-emerald-700' : c.required ? 'text-red-700' : 'text-amber-700'}`}>{c.label}</span>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Back</button>
          <button disabled={!canSend || sending} onClick={onSend} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main EmailBuilder ────────────────────────────────────────────────────────

export interface EmailBuilderProps {
  subject: string; previewText: string;
  segmentId?: string; segments?: Array<{ id: string; name: string }>;
  onSubjectChange: (v: string) => void; onPreviewTextChange: (v: string) => void; onSegmentChange?: (v: string) => void;
  onSave: (html: string) => void; onClose: () => void;
  onSend?: (html: string) => void; sending?: boolean; hasContacts?: boolean;
  initialHtml?: string;
}

export default function EmailBuilder({
  subject, previewText, segmentId = '', segments = [],
  onSubjectChange, onPreviewTextChange, onSegmentChange,
  onSave, onClose, onSend, sending = false, hasContacts = true, initialHtml: _ih,
}: EmailBuilderProps) {
  const [blocks, setBlocks] = useState<EmailBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedColId, setSelectedColId] = useState<string | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('add');
  const [showPreview, setShowPreview] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  // DnD
  const [dragInfo, setDragInfo] = useState<DragInfo | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null;

  // ── Block CRUD ──
  const addLeaf = useCallback((type: LeafBlockType, atIndex?: number) => {
    const b = defaultLeaf(type);
    setBlocks(prev => {
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, b);
      return next;
    });
    setSelectedId(b.id); setSelectedColId(null); setPanelMode('edit');
    setTimeout(() => canvasRef.current?.querySelector(`[data-block-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }, []);

  const addSection = useCallback((preset: SectionPreset, atIndex?: number) => {
    const sec = makeSection(preset.fractions);
    setBlocks(prev => {
      const next = [...prev];
      next.splice(atIndex ?? next.length, 0, sec);
      return next;
    });
    setSelectedId(sec.id); setSelectedColId(null); setPanelMode('edit');
  }, []);

  const updateBlock = useCallback((updated: EmailBlock) => {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
  }, []);

  const deleteBlock = useCallback((id: string) => {
    setBlocks(prev => { const next = prev.filter(b => b.id !== id); setSelectedId(next[0]?.id ?? null); return next; });
    setSelectedColId(null);
  }, []);

  const applyTemplate = useCallback((t: Template) => {
    const nb = t.blocks(); setBlocks(nb); setSelectedId(nb[0]?.id ?? null); setSelectedColId(null); setShowTemplatePicker(false);
  }, []);

  // ── Column CRUD ──
  const dropToColumn = useCallback((sectionId: string, colId: string) => {
    if (!dragInfo || dragInfo.source !== 'palette' || !dragInfo.blockType) return;
    const module = defaultLeaf(dragInfo.blockType);
    setBlocks(prev => prev.map(b => {
      if (b.id !== sectionId || b.type !== 'section') return b;
      return { ...b, columns: b.columns.map(c => c.id === colId ? { ...c, blocks: [...c.blocks, module] } : c) };
    }));
    setSelectedId(sectionId); setSelectedColId(colId); setPanelMode('edit');
    setDragInfo(null); setDragOverColId(null);
  }, [dragInfo]);

  const colModuleDelete = useCallback((colId: string, moduleId: string) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== selectedId || b.type !== 'section') return b;
      return { ...b, columns: b.columns.map(c => c.id === colId ? { ...c, blocks: c.blocks.filter(m => m.id !== moduleId) } : c) };
    }));
  }, [selectedId]);

  const colModuleAdd = useCallback((colId: string, type: LeafBlockType) => {
    const m = defaultLeaf(type);
    setBlocks(prev => prev.map(b => {
      if (b.id !== selectedId || b.type !== 'section') return b;
      return { ...b, columns: b.columns.map(c => c.id === colId ? { ...c, blocks: [...c.blocks, m] } : c) };
    }));
  }, [selectedId]);

  const colModuleUpdate = useCallback((colId: string, module: LeafBlock) => {
    setBlocks(prev => prev.map(b => {
      if (b.id !== selectedId || b.type !== 'section') return b;
      return { ...b, columns: b.columns.map(c => c.id === colId ? { ...c, blocks: c.blocks.map(m => m.id === module.id ? module : m) } : c) };
    }));
  }, [selectedId]);

  // ── DnD ──
  const handleDragStartLeaf = useCallback((e: DragEvent<HTMLDivElement>, type: LeafBlockType) => {
    e.dataTransfer.effectAllowed = 'copy'; setDragInfo({ source: 'palette', blockType: type });
  }, []);

  const handleDragStartSection = useCallback((e: DragEvent<HTMLDivElement>, preset: SectionPreset) => {
    e.dataTransfer.effectAllowed = 'copy'; setDragInfo({ source: 'palette', blockType: undefined, blockId: preset.id });
    // Attach preset info on the drag event for reference
    e.dataTransfer.setData('text/plain', preset.id);
  }, []);

  const handleDragStartCanvas = useCallback((e: DragEvent<HTMLDivElement>, blockId: string) => {
    e.dataTransfer.effectAllowed = 'move'; setDragInfo({ source: 'canvas', blockId });
  }, []);

  const handleDrop = useCallback((index: number) => {
    if (!dragInfo) return;
    if (dragInfo.source === 'palette') {
      if (dragInfo.blockType) {
        addLeaf(dragInfo.blockType, index);
      } else if (dragInfo.blockId) {
        // It's a section preset — find by id
        const preset = SECTION_PRESETS.find(p => p.id === dragInfo.blockId);
        if (preset) addSection(preset, index);
      }
    } else if (dragInfo.source === 'canvas' && dragInfo.blockId) {
      setBlocks(prev => {
        const from = prev.findIndex(b => b.id === dragInfo.blockId);
        if (from === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(from < index ? index - 1 : index, 0, moved);
        return next;
      });
    }
    setDragInfo(null); setDropIndex(null);
  }, [dragInfo, addLeaf, addSection]);

  const handleCanvasDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!dragInfo) return;
    e.dataTransfer.dropEffect = dragInfo.source === 'canvas' ? 'move' : 'copy';
    const canvas = canvasRef.current; if (!canvas) return;
    const els = Array.from(canvas.querySelectorAll('[data-canvas-block]')) as HTMLElement[];
    let idx = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { idx = i; break; }
    }
    setDropIndex(idx);
  }, [dragInfo]);

  const handleCanvasDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); if (dropIndex !== null) handleDrop(dropIndex);
  }, [dropIndex, handleDrop]);

  const handleCanvasDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) { setDropIndex(null); }
  }, []);

  const selectBlock = (id: string) => { setSelectedId(id); setSelectedColId(null); setPanelMode('edit'); };

  const html = blocksToHtml(blocks);

  const sidebarIcons: Array<{ mode: PanelMode; icon: React.ElementType; label: string; disabled?: boolean }> = [
    { mode: 'add', icon: Plus, label: 'Add' },
    { mode: 'contents', icon: List, label: 'Contents' },
    { mode: 'edit', icon: Settings, label: 'Edit', disabled: !selectedBlock },
  ];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#f0f2f5]">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-[#1f1f1f] px-4 text-white">
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-300 hover:bg-white/10">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex items-center gap-2 border-l border-white/10 pl-3 text-slate-300 text-sm">
          <span className="cursor-pointer hover:text-white">File</span>
          <span className="cursor-pointer hover:text-white">Help</span>
        </div>
        <div className="flex flex-1 items-center justify-center gap-2">
          <span className="text-sm font-semibold text-white">{subject.trim() || 'New email'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500">Autosaved</span>
          <button onClick={() => onSave(html)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/20">Save</button>
          <button onClick={() => setShowPreview(true)} className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-semibold text-white hover:bg-white/10">
            <Eye size={13} /> Preview <ChevronDown size={12} />
          </button>
          {onSend && <button onClick={() => setShowChecklist(true)} className="rounded-lg bg-[#ff7a59] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#ff6a45]">Review and send</button>}
        </div>
      </div>

      {/* Sub bar */}
      <div className="flex h-10 shrink-0 items-center justify-center gap-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
          <button className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-700"><Monitor size={14} /></button>
          <button className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50"><Smartphone size={14} /></button>
        </div>
        <select value={segmentId} onChange={e => onSegmentChange?.(e.target.value)} className="h-7 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 outline-none focus:border-[#5b6cf9]">
          <option value="">To: All contacts</option>
          {segments.map(s => <option key={s.id} value={s.id}>To: {s.name}</option>)}
        </select>
        <input value={subject} onChange={e => onSubjectChange(e.target.value)} placeholder="Subject line…" className="h-7 w-48 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#5b6cf9]" />
        <input value={previewText} onChange={e => onPreviewTextChange(e.target.value)} placeholder="Preview text…" className="h-7 w-36 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-[#5b6cf9]" />
        <button onClick={() => setShowTemplatePicker(true)} className="h-7 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">Templates</button>
      </div>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel */}
        <div className="flex w-72 shrink-0 border-r border-slate-200 bg-white">
          <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-slate-100 bg-slate-50 py-3">
            {sidebarIcons.map(({ mode, icon: Icon, label, disabled }) => (
              <button key={mode} onClick={() => !disabled && setPanelMode(mode)} disabled={disabled} title={label}
                className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${panelMode === mode ? 'bg-[#5b6cf9] text-white' : disabled ? 'cursor-not-allowed text-slate-300' : 'text-slate-500 hover:bg-slate-200'}`}>
                <Icon size={16} />
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {panelMode === 'add' && (
              <AddPanel
                onAddLeaf={addLeaf}
                onAddSection={addSection}
                onDragStartLeaf={handleDragStartLeaf}
                onDragStartSection={handleDragStartSection}
              />
            )}
            {panelMode === 'contents' && (
              <ContentsPanel blocks={blocks} selectedId={selectedId} subject={subject} previewText={previewText} onSelect={selectBlock} />
            )}
            {panelMode === 'edit' && selectedBlock && (
              <EditPanel
                block={selectedBlock}
                onChange={updateBlock}
                selectedColId={selectedColId}
                onColModuleDelete={colModuleDelete}
                onColModuleAdd={colModuleAdd}
                onUpdateColModule={colModuleUpdate}
              />
            )}
            {panelMode === 'edit' && !selectedBlock && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <Settings size={24} className="mb-2 opacity-30" />
                <p className="text-xs text-center">Click a block to edit its properties.</p>
              </div>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex flex-1 flex-col overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) { setSelectedId(null); setSelectedColId(null); setPanelMode('add'); } }}>
          <div className="mx-auto my-8 w-full max-w-[660px] px-4">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              <div
                ref={canvasRef}
                onDragOver={handleCanvasDragOver}
                onDrop={handleCanvasDrop}
                onDragLeave={handleCanvasDragLeave}
              >
                {blocks.length === 0 ? (
                  <div className={`flex flex-col items-center justify-center py-24 transition-colors ${dragInfo ? 'bg-indigo-50' : ''}`}>
                    {dragInfo ? (
                      <><div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#5b6cf9]/10 text-[#5b6cf9]"><Plus size={24} /></div><p className="text-sm font-semibold text-[#5b6cf9]">Drop to add</p></>
                    ) : (
                      <><Layout size={36} className="mb-4 opacity-30 text-slate-400" /><p className="text-sm font-semibold text-slate-600">Start building your email</p><p className="mt-1 text-xs text-slate-400">Drag modules from the left, or use a template.</p>
                      <div className="mt-5 flex gap-2">
                        <button onClick={e => { e.stopPropagation(); setShowTemplatePicker(true); }} className="rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">Choose Template</button>
                        <button onClick={e => { e.stopPropagation(); addLeaf('text'); }} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Add Text Block</button>
                      </div></>
                    )}
                  </div>
                ) : (
                  <>
                    {!!dragInfo && !dragInfo.blockId && <GapZone isActive={dropIndex === 0} />}
                    {blocks.map((block, i) => (
                      <div key={block.id} data-block-id={block.id}>
                        {block.type === 'section' ? (
                          <SectionView
                            section={block}
                            isSelected={selectedId === block.id}
                            selectedColId={selectedId === block.id ? selectedColId : null}
                            isDragging={dragInfo?.source === 'canvas' && dragInfo.blockId === block.id}
                            isDraggingActive={!!dragInfo && dragInfo.source === 'palette'}
                            dragOverColId={selectedId === block.id || dragInfo?.source === 'palette' ? dragOverColId : null}
                            onSelectSection={e => { e.stopPropagation(); setSelectedId(block.id); setSelectedColId(null); setPanelMode('edit'); }}
                            onSelectCol={(colId, e) => { e.stopPropagation(); setSelectedId(block.id); setSelectedColId(colId); setPanelMode('edit'); }}
                            onDragOver={(colId, e) => { e.preventDefault(); setDragOverColId(colId); }}
                            onDragLeave={() => setDragOverColId(null)}
                            onDropToCol={(colId, e) => { e.preventDefault(); dropToColumn(block.id, colId); }}
                            onDragStartSection={e => handleDragStartCanvas(e, block.id)}
                            onDragEndSection={() => { setDragInfo(null); setDropIndex(null); }}
                            onDelete={e => { e.stopPropagation(); deleteBlock(block.id); }}
                          />
                        ) : (
                          <LeafCanvasBlock
                            block={block}
                            selected={selectedId === block.id}
                            isDragging={dragInfo?.source === 'canvas' && dragInfo.blockId === block.id}
                            onSelect={() => selectBlock(block.id)}
                            onDelete={() => deleteBlock(block.id)}
                            onDragStart={e => handleDragStartCanvas(e, block.id)}
                            onDragEnd={() => { setDragInfo(null); setDropIndex(null); }}
                          />
                        )}
                        {!!dragInfo && !dragInfo.blockId && <GapZone isActive={dropIndex === i + 1} />}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">
              Click to edit · Drag to reorder · {blocks.length} item{blocks.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      {showPreview && <PreviewModal html={html} onClose={() => setShowPreview(false)} />}
      {showTemplatePicker && <TemplatePicker onSelect={applyTemplate} onClose={() => setShowTemplatePicker(false)} />}
      {showChecklist && (
        <PreSendChecklist blocks={blocks} subject={subject} hasContacts={hasContacts} sending={sending}
          onSend={() => { onSend?.(blocksToHtml(blocks)); setShowChecklist(false); }}
          onClose={() => setShowChecklist(false)} />
      )}
    </div>
  );
}
