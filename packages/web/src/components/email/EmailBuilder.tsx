import { useState, useRef, useCallback } from 'react';
import {
  ChevronDown, ChevronUp, Eye, Loader2, Minus, Monitor, Plus,
  Smartphone, Trash2, Type, X, Square, Image as ImageIcon,
  Link, AlignCenter, AlignLeft, AlignRight, Layout,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Align = 'left' | 'center' | 'right';

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

export type EmailBlock =
  | HeaderBlock | TextBlock | ImageBlock | ButtonBlock
  | DividerBlock | SpacerBlock | FooterBlock;

// ─── HTML Generation ──────────────────────────────────────────────────────────

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
    case 'header':   return { id: uid(), type: 'header', headline: 'Your Headline Here', subheadline: 'A short supporting tagline', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 40 };
    case 'text':     return { id: uid(), type: 'text', content: 'Write your email body here. You can use <strong>bold</strong>, <em>italic</em>, or <a href="#">links</a>.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.7 };
    case 'image':    return { id: uid(), type: 'image', src: '', alt: '', href: '', align: 'center', padding: 24 };
    case 'button':   return { id: uid(), type: 'button', text: 'Get Started', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 };
    case 'divider':  return { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 16 };
    case 'spacer':   return { id: uid(), type: 'spacer', height: 24 };
    case 'footer':   return { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St, City, Country', bgColor: '#f9fafb', textColor: '#6b7280' };
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
    id: 'newsletter', name: 'Newsletter', emoji: '📰', description: 'Regular updates for your subscribers',
    blocks: () => [
      { id: uid(), type: 'header', headline: 'Monthly Newsletter', subheadline: 'Your roundup for June 2025', bgColor: '#1e293b', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 0 },
      { id: uid(), type: 'text', content: '<strong>Hi {{first_name}},</strong><br/><br/>Here\'s what\'s been happening this month. We\'ve been working hard to bring you the best content and updates.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'text', content: '<strong style="font-size:20px;color:#1e293b;">Top Stories This Month</strong><br/><br/>• <a href="#">Story one — a short description of the update</a><br/>• <a href="#">Story two — another key update you should know</a><br/>• <a href="#">Story three — an exciting announcement coming soon</a>', bgColor: '#f8fafc', textColor: '#374151', fontSize: 15, padding: 28, lineHeight: 1.9 },
      { id: uid(), type: 'button', text: 'Read More Stories', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 15 },
      { id: uid(), type: 'divider', color: '#e5e7eb', thickness: 1, padding: 16 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '123 Main St, City, Country', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'promotional', name: 'Promotional', emoji: '🛍️', description: 'Sales & limited-time offers',
    blocks: () => [
      { id: uid(), type: 'header', headline: '🔥 Limited Time Offer', subheadline: 'Don\'t miss out — this deal expires soon', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: '<p style="font-size:36px;font-weight:700;text-align:center;color:#1e293b;margin:0;">50% OFF</p><p style="text-align:center;color:#6b7280;margin:8px 0 0;">Everything in the store this weekend only</p>', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.6 },
      { id: uid(), type: 'text', content: 'Hi {{first_name}},<br/><br/>We\'re giving you an exclusive deal. Use the button below to claim your discount before it expires. This offer is only valid for the next 48 hours.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 28, lineHeight: 1.7 },
      { id: uid(), type: 'button', text: '🛍️ Shop Now — 50% Off', href: '#', bgColor: '#ef4444', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 10, fontSize: 17 },
      { id: uid(), type: 'text', content: '<p style="text-align:center;color:#9ca3af;font-size:13px;">Use code <strong>SAVE50</strong> at checkout. Expires midnight Sunday.</p>', bgColor: '#ffffff', textColor: '#9ca3af', fontSize: 13, padding: 16, lineHeight: 1.5 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'welcome', name: 'Welcome Email', emoji: '👋', description: 'Greet new subscribers',
    blocks: () => [
      { id: uid(), type: 'header', headline: 'Welcome aboard, {{first_name}}! 👋', subheadline: 'We\'re so glad you\'re here', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: 'Hi {{first_name}},<br/><br/>Thank you for joining us! You\'re now part of our community and we\'re excited to have you.<br/><br/>Here\'s what you can expect from us:', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'text', content: '✅ &nbsp;<strong>Weekly updates</strong> with the latest news<br/>✅ &nbsp;<strong>Exclusive offers</strong> for members only<br/>✅ &nbsp;<strong>Tips & resources</strong> to help you succeed', bgColor: '#f0f4ff', textColor: '#374151', fontSize: 16, padding: 28, lineHeight: 2.2 },
      { id: uid(), type: 'button', text: 'Get Started →', href: '#', bgColor: '#5b6cf9', textColor: '#ffffff', align: 'center', padding: 32, borderRadius: 8, fontSize: 16 },
      { id: uid(), type: 'spacer', height: 8 },
      { id: uid(), type: 'footer', companyName: 'Your Company', address: '', bgColor: '#f9fafb', textColor: '#6b7280' },
    ],
  },
  {
    id: 'announcement', name: 'Announcement', emoji: '📣', description: 'Share big news with your audience',
    blocks: () => [
      { id: uid(), type: 'header', headline: '📣 Big News!', subheadline: 'We have an exciting announcement to share', bgColor: '#0f172a', textColor: '#ffffff', align: 'center', padding: 48 },
      { id: uid(), type: 'text', content: 'Hi {{first_name}},<br/><br/>We\'ve been working on something big and we\'re finally ready to share it with you.', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.8 },
      { id: uid(), type: 'text', content: '<p style="font-size:22px;font-weight:700;color:#0f172a;text-align:center;">Introducing [Your New Feature]</p><p style="text-align:center;color:#6b7280;">The thing you\'ve been waiting for is finally here.</p>', bgColor: '#f8fafc', textColor: '#374151', fontSize: 16, padding: 32, lineHeight: 1.6 },
      { id: uid(), type: 'text', content: 'Here\'s what\'s new:<br/><br/>→ <strong>Feature one</strong> — description of benefit<br/>→ <strong>Feature two</strong> — description of benefit<br/>→ <strong>Feature three</strong> — description of benefit', bgColor: '#ffffff', textColor: '#374151', fontSize: 16, padding: 28, lineHeight: 2 },
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
  { label: 'Unsubscribe URL', value: '{{unsubscribe_url}}' },
];

// ─── Canvas block renderer ────────────────────────────────────────────────────

function CanvasBlock({
  block, selected, onSelect, onMove, onDelete, isFirst, isLast,
}: {
  block: EmailBlock; selected: boolean;
  onSelect: () => void; onMove: (dir: -1 | 1) => void; onDelete: () => void;
  isFirst: boolean; isLast: boolean;
}) {
  const ring = selected
    ? 'outline outline-2 outline-[#5b6cf9] outline-offset-[-2px]'
    : 'hover:outline hover:outline-1 hover:outline-slate-300 hover:outline-offset-[-1px]';

  const controls = selected && (
    <div className="absolute right-2 top-2 z-10 flex gap-1" onClick={e => e.stopPropagation()}>
      {!isFirst && (
        <button onClick={() => onMove(-1)} className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-slate-600 shadow hover:bg-white">
          <ChevronUp size={12} />
        </button>
      )}
      {!isLast && (
        <button onClick={() => onMove(1)} className="flex h-6 w-6 items-center justify-center rounded bg-white/90 text-slate-600 shadow hover:bg-white">
          <ChevronDown size={12} />
        </button>
      )}
      <button onClick={onDelete} className="flex h-6 w-6 items-center justify-center rounded bg-red-50 text-red-500 shadow hover:bg-red-100">
        <Trash2 size={11} />
      </button>
    </div>
  );

  const wrap = (content: React.ReactNode) => (
    <div
      className={`relative cursor-pointer select-none ${ring}`}
      onClick={onSelect}
    >
      {controls}
      {content}
    </div>
  );

  switch (block.type) {
    case 'header':
      return wrap(
        <div style={{ backgroundColor: block.bgColor, padding: block.padding, textAlign: block.align }}>
          <div style={{ color: block.textColor, fontSize: 26, fontWeight: 700, lineHeight: 1.3, fontFamily: 'Arial, sans-serif' }}>{block.headline || <em style={{ opacity: 0.4 }}>Headline…</em>}</div>
          {block.subheadline && <div style={{ color: block.textColor, fontSize: 16, marginTop: 8, opacity: 0.85, fontFamily: 'Arial, sans-serif' }}>{block.subheadline}</div>}
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
  }
}

// ─── Properties Panel ─────────────────────────────────────────────────────────

function PropertiesPanel({ block, onChange }: { block: EmailBlock; onChange: (b: EmailBlock) => void }) {
  const set = useCallback(<K extends string>(key: K, value: unknown) => {
    onChange({ ...block, [key]: value } as EmailBlock);
  }, [block, onChange]);

  const field = (label: string, children: React.ReactNode) => (
    <div className="space-y-1">
      <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</label>
      {children}
    </div>
  );

  const input = (key: string, value: string, placeholder?: string) => (
    <input
      value={value} placeholder={placeholder}
      onChange={e => set(key, e.target.value)}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
    />
  );

  const numInput = (key: string, value: number, min = 0, max = 999) => (
    <input
      type="number" min={min} max={max} value={value}
      onChange={e => set(key, Number(e.target.value))}
      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
    />
  );

  const colorInput = (key: string, value: string) => (
    <div className="flex items-center gap-2">
      <input type="color" value={value} onChange={e => set(key, e.target.value)} className="h-8 w-8 cursor-pointer rounded border border-slate-200 bg-white p-0.5" />
      <input value={value} onChange={e => set(key, e.target.value)} className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono outline-none focus:border-slate-400" />
    </div>
  );

  const alignButtons = (key: string, value: Align) => (
    <div className="flex rounded-lg border border-slate-200 overflow-hidden">
      {(['left', 'center', 'right'] as Align[]).map(a => (
        <button key={a} onClick={() => set(key, a)} className={`flex flex-1 items-center justify-center py-2 text-xs transition-colors ${value === a ? 'bg-slate-950 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
          {a === 'left' ? <AlignLeft size={13} /> : a === 'center' ? <AlignCenter size={13} /> : <AlignRight size={13} />}
        </button>
      ))}
    </div>
  );

  const textarea = (key: string, value: string, rows = 4, placeholder?: string) => (
    <textarea
      value={value} rows={rows} placeholder={placeholder}
      onChange={e => set(key, e.target.value)}
      className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
    />
  );

  const BLOCK_LABEL: Record<EmailBlock['type'], string> = {
    header: 'Header Block', text: 'Text Block', image: 'Image Block',
    button: 'Button Block', divider: 'Divider', spacer: 'Spacer', footer: 'Footer Block',
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-slate-100 px-3 py-2">
        <span className="text-xs font-bold text-slate-600">{BLOCK_LABEL[block.type]}</span>
      </div>

      {block.type === 'header' && <>
        {field('Headline', input('headline', block.headline, 'Headline text…'))}
        {field('Subheadline', input('subheadline', block.subheadline, 'Optional subheading…'))}
        {field('Background Color', colorInput('bgColor', block.bgColor))}
        {field('Text Color', colorInput('textColor', block.textColor))}
        {field('Alignment', alignButtons('align', block.align))}
        {field('Padding (px)', numInput('padding', block.padding, 0, 120))}
      </>}

      {block.type === 'text' && <>
        {field('Content (HTML supported)', textarea('content', block.content, 6, 'Your text here…'))}
        <div className="rounded-lg bg-blue-50 p-2.5">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-500">Personalization Tokens</p>
          <div className="flex flex-wrap gap-1">
            {TOKENS.slice(0, 4).map(t => (
              <button key={t.value} onClick={() => set('content', block.content + t.value)}
                className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-200">
                {t.value}
              </button>
            ))}
          </div>
        </div>
        {field('Background Color', colorInput('bgColor', block.bgColor))}
        {field('Text Color', colorInput('textColor', block.textColor))}
        {field('Font Size (px)', numInput('fontSize', block.fontSize, 10, 48))}
        {field('Line Height', <input type="number" min={1} max={3} step={0.1} value={block.lineHeight} onChange={e => set('lineHeight', parseFloat(e.target.value))} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400" />)}
        {field('Padding (px)', numInput('padding', block.padding, 0, 120))}
      </>}

      {block.type === 'image' && <>
        {field('Image URL', input('src', block.src, 'https://…'))}
        {field('Alt Text', input('alt', block.alt, 'Image description'))}
        {field('Link URL (optional)', input('href', block.href, 'https://…'))}
        {field('Alignment', alignButtons('align', block.align))}
        {field('Padding (px)', numInput('padding', block.padding, 0, 120))}
      </>}

      {block.type === 'button' && <>
        {field('Button Text', input('text', block.text, 'Click here…'))}
        {field('Button URL', input('href', block.href, 'https://…'))}
        {field('Background Color', colorInput('bgColor', block.bgColor))}
        {field('Text Color', colorInput('textColor', block.textColor))}
        {field('Alignment', alignButtons('align', block.align))}
        {field('Font Size (px)', numInput('fontSize', block.fontSize, 10, 36))}
        {field('Border Radius (px)', numInput('borderRadius', block.borderRadius, 0, 50))}
        {field('Padding (px)', numInput('padding', block.padding, 0, 120))}
      </>}

      {block.type === 'divider' && <>
        {field('Color', colorInput('color', block.color))}
        {field('Thickness (px)', numInput('thickness', block.thickness, 1, 10))}
        {field('Vertical Padding (px)', numInput('padding', block.padding, 0, 60))}
      </>}

      {block.type === 'spacer' && <>
        {field('Height (px)', numInput('height', block.height, 4, 200))}
      </>}

      {block.type === 'footer' && <>
        {field('Company Name', input('companyName', block.companyName, 'Your Company'))}
        {field('Address', input('address', block.address, '123 Street, City'))}
        {field('Background Color', colorInput('bgColor', block.bgColor))}
        {field('Text Color', colorInput('textColor', block.textColor))}
        <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-700">
          An unsubscribe link is automatically appended using <code>{'{{unsubscribe_url}}'}</code>.
        </p>
      </>}
    </div>
  );
}

// ─── Block Palette ────────────────────────────────────────────────────────────

const PALETTE: Array<{ type: EmailBlock['type']; label: string; icon: React.ElementType; color: string }> = [
  { type: 'header',  label: 'Header',  icon: Type,      color: 'bg-indigo-50 text-indigo-600' },
  { type: 'text',    label: 'Text',    icon: Layout,    color: 'bg-slate-50 text-slate-600' },
  { type: 'image',   label: 'Image',   icon: ImageIcon, color: 'bg-emerald-50 text-emerald-600' },
  { type: 'button',  label: 'Button',  icon: Link,      color: 'bg-blue-50 text-blue-600' },
  { type: 'divider', label: 'Divider', icon: Minus,     color: 'bg-slate-50 text-slate-500' },
  { type: 'spacer',  label: 'Spacer',  icon: Square,    color: 'bg-slate-50 text-slate-400' },
  { type: 'footer',  label: 'Footer',  icon: Layout,    color: 'bg-slate-50 text-slate-600' },
];

// ─── Preview Modal ────────────────────────────────────────────────────────────

function PreviewModal({ html, onClose }: { html: string; onClose: () => void }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-900">
      {/* Header */}
      <div className="flex h-14 items-center justify-between border-b border-slate-700 px-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Email Preview</span>
          <div className="flex rounded-lg border border-slate-600 overflow-hidden">
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

      {/* Iframe */}
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
            <p className="text-sm text-slate-500 mt-0.5">Start with a pre-built layout or build from scratch.</p>
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

interface ChecklistProps {
  blocks: EmailBlock[];
  subject: string;
  hasContacts: boolean;
  onSend: () => void;
  onClose: () => void;
  sending: boolean;
}

function PreSendChecklist({ blocks, subject, hasContacts, onSend, onClose, sending }: ChecklistProps) {
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
          <h2 className="text-lg font-black text-slate-950">Pre-Send Checklist</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
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
        {errors.length > 0 && (
          <div className="mx-6 mb-4 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
            Fix {errors.length} required issue{errors.length > 1 ? 's' : ''} before sending.
          </div>
        )}
        {warnings.length > 0 && errors.length === 0 && (
          <div className="mx-6 mb-4 rounded-xl bg-amber-50 px-4 py-2.5 text-sm text-amber-700">
            {warnings.length} optional suggestion{warnings.length > 1 ? 's' : ''} — you can still send.
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600">Back to Editor</button>
          <button disabled={!canSend || sending} onClick={onSend}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:opacity-40">
            {sending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : '✉ Send Now'}
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
  onSave, onClose, onSend, sending = false, hasContacts = true, initialHtml,
}: EmailBuilderProps) {
  const firstTemplate = TEMPLATES[0].blocks();
  const [blocks, setBlocks] = useState<EmailBlock[]>(() => {
    if (initialHtml) return [];
    return firstTemplate;
  });
  const [selectedId, setSelectedId] = useState<string | null>(blocks[0]?.id ?? null);
  const [showPreview, setShowPreview] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(!initialHtml);
  const [showChecklist, setShowChecklist] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const selectedBlock = blocks.find(b => b.id === selectedId) ?? null;

  const addBlock = useCallback((type: EmailBlock['type']) => {
    const b = defaultBlock(type);
    setBlocks(prev => [...prev, b]);
    setSelectedId(b.id);
    setTimeout(() => canvasRef.current?.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
  }, []);

  const updateBlock = useCallback((updated: EmailBlock) => {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b));
  }, []);

  const moveBlock = useCallback((id: string, dir: -1 | 1) => {
    setBlocks(prev => {
      const i = prev.findIndex(b => b.id === id);
      if (i < 0) return prev;
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
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

  const html = blocksToHtml(blocks);

  const handleSave = () => onSave(html);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      {/* ── Top bar ── */}
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4">
        <button onClick={onClose} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          <X size={15} /> Close
        </button>
        <div className="h-5 w-px bg-slate-200" />
        <input
          value={subject} onChange={e => onSubjectChange(e.target.value)}
          placeholder="Subject line *"
          className="h-9 w-56 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium outline-none focus:border-slate-400 focus:bg-white"
        />
        <select
          value={segmentId}
          onChange={e => onSegmentChange?.(e.target.value)}
          className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400 focus:bg-white text-slate-700"
        >
          <option value="">To: All contacts</option>
          {segments.map(s => <option key={s.id} value={s.id}>To: {s.name}</option>)}
        </select>
        <input
          value={previewText} onChange={e => onPreviewTextChange(e.target.value)}
          placeholder="Preview text…"
          className="h-9 w-48 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-slate-400 focus:bg-white"
        />
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowTemplatePicker(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Layout size={14} /> Templates
          </button>
          <button onClick={() => setShowPreview(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Eye size={14} /> Preview
          </button>
          <button onClick={handleSave}
            className="rounded-lg border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Save Draft
          </button>
          {onSend && (
            <button onClick={() => setShowChecklist(true)}
              className="flex items-center gap-1.5 rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white hover:bg-slate-800">
              <Plus size={14} /> Review & Send
            </button>
          )}
        </div>
      </div>

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: block palette */}
        <div className="flex w-48 shrink-0 flex-col border-r border-slate-200 bg-slate-50 p-3">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Add Blocks</p>
          <div className="space-y-1.5">
            {PALETTE.map(({ type, label, icon: Icon, color }) => (
              <button key={type} onClick={() => addBlock(type)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-transparent bg-white px-3 py-2 text-left text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-200 hover:bg-slate-50 transition-all">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${color}`}>
                  <Icon size={14} />
                </span>
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">Tokens</p>
            <div className="space-y-1">
              {TOKENS.slice(0, 3).map(t => (
                <button key={t.value} onClick={() => {
                  if (selectedBlock?.type === 'text' || selectedBlock?.type === 'header') {
                    const key = selectedBlock.type === 'text' ? 'content' : 'headline';
                    updateBlock({ ...selectedBlock, [key]: (selectedBlock as any)[key] + t.value } as EmailBlock);
                  }
                }}
                  title={`Insert ${t.label} — click to append to selected text/header block`}
                  className="flex w-full items-center rounded-md bg-white px-2 py-1.5 text-left text-[11px] font-mono text-slate-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors border border-slate-100">
                  {t.value}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center: canvas */}
        <div className="flex flex-1 flex-col overflow-y-auto bg-slate-100">
          <div className="mx-auto my-8 w-full max-w-[640px]">
            {/* Email frame */}
            <div className="rounded-xl shadow-lg overflow-hidden border border-slate-200">
              <div ref={canvasRef} className="bg-white">
                {blocks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-24 text-slate-400">
                    <Layout size={36} className="mb-4 opacity-30" />
                    <p className="text-sm font-semibold">No blocks yet</p>
                    <p className="mt-1 text-xs">Add blocks from the left panel or choose a template.</p>
                    <button onClick={() => setShowTemplatePicker(true)}
                      className="mt-5 rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
                      Choose Template
                    </button>
                  </div>
                ) : (
                  blocks.map((block, i) => (
                    <CanvasBlock
                      key={block.id}
                      block={block}
                      selected={selectedId === block.id}
                      onSelect={() => setSelectedId(block.id)}
                      onMove={(dir) => moveBlock(block.id, dir)}
                      onDelete={() => deleteBlock(block.id)}
                      isFirst={i === 0}
                      isLast={i === blocks.length - 1}
                    />
                  ))
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-xs text-slate-400">
              Click a block to edit · Use ↑↓ arrows to reorder · 600px email width
            </p>
          </div>
        </div>

        {/* Right: properties */}
        <div className="flex w-64 shrink-0 flex-col border-l border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">
              {selectedBlock ? 'Block Properties' : 'Properties'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {selectedBlock ? (
              <PropertiesPanel block={selectedBlock} onChange={updateBlock} />
            ) : (
              <div className="flex flex-col items-center py-12 text-slate-400">
                <Square size={24} className="mb-2 opacity-30" />
                <p className="text-xs text-center">Select a block to edit its properties.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      {showPreview && <PreviewModal html={html} onClose={() => setShowPreview(false)} />}
      {showTemplatePicker && <TemplatePicker onSelect={applyTemplate} onClose={() => setShowTemplatePicker(false)} />}
      {showChecklist && (
        <PreSendChecklist
          blocks={blocks} subject={subject} hasContacts={hasContacts}
          sending={sending}
          onSend={() => { onSend?.(blocksToHtml(blocks)); setShowChecklist(false); }}
          onClose={() => setShowChecklist(false)}
        />
      )}
    </div>
  );
}
