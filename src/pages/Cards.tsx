import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Clock } from 'lucide-react';
import AdvancedTemplateCard from '../components/AdvancedTemplateCard';
import PrebuiltTemplates from '../components/PrebuiltTemplates';
import { cardTemplates, cloneCardTemplate } from '../data/cardTemplates';
import { CardTemplate, AdminCardTemplate } from '../types/cardTemplate';
import { cardTemplateService } from '../services/cardTemplateService';
import { designService, UserDesign } from '../services/designService';
import CardBuilderModal from '../components/cards/builder/CardBuilderModal';

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ── Design card thumbnail ─────────────────────────────────────────────────────
function DesignThumb({
  design,
  onOpen,
  onDelete,
}: {
  design: UserDesign;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await designService.delete(design.id);
      onDelete();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      {/* Thumbnail */}
      <div
        className="relative aspect-square overflow-hidden bg-zinc-100 cursor-pointer"
        onClick={onOpen}
      >
        {design.thumbnail_url ? (
          <img
            src={design.thumbnail_url}
            alt={design.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <span className="text-sm text-zinc-400">No preview</span>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
          <div className="rounded-xl bg-white/90 px-4 py-2 text-sm font-semibold text-zinc-900 shadow">
            Open in Builder
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{design.name}</p>
          <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
            <Clock size={10} />
            {formatDate(design.updated_at)}
          </p>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={onOpen}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition"
            title="Edit design"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-200 text-red-400 hover:bg-red-50 transition disabled:opacity-50"
            title="Delete design"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const Cards = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<CardTemplate | null>(null);
  const [publishedTemplates, setPublishedTemplates] = useState<AdminCardTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);

  // My designs
  const [myDesigns, setMyDesigns] = useState<UserDesign[]>([]);
  const [isLoadingDesigns, setIsLoadingDesigns] = useState(true);

  // Builder modal
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingDesign, setEditingDesign] = useState<UserDesign | null>(null);

  // Fetch published templates
  useEffect(() => {
    cardTemplateService
      .getPublishedTemplates()
      .then((t) => setPublishedTemplates(t))
      .catch(() => setPublishedTemplates([]))
      .finally(() => setIsLoadingTemplates(false));
  }, []);

  // Fetch user designs
  const fetchDesigns = () => {
    setIsLoadingDesigns(true);
    designService
      .list()
      .then((d) => setMyDesigns(d))
      .catch(() => setMyDesigns([]))
      .finally(() => setIsLoadingDesigns(false));
  };

  useEffect(() => {
    fetchDesigns();
  }, []);

  const openNewDesign = () => {
    setEditingDesign(null);
    setBuilderOpen(true);
  };

  const openDesign = (design: UserDesign) => {
    setEditingDesign(design);
    setBuilderOpen(true);
  };

  const handleBuilderClose = () => {
    setBuilderOpen(false);
    setEditingDesign(null);
  };

  const handleDesignSaved = (saved: UserDesign) => {
    setMyDesigns((prev) => {
      const idx = prev.findIndex((d) => d.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  };

  const handleDeleteDesign = (id: string) => {
    setMyDesigns((prev) => prev.filter((d) => d.id !== id));
  };

  const handleSelectTemplate = (template: CardTemplate) => {
    setSelectedTemplate(cloneCardTemplate(template));
  };

  const handleSelectPublishedTemplate = (template: AdminCardTemplate) => {
    setSelectedTemplate(cloneCardTemplate(template.designData));
  };

  // ── Builder open (full-screen) ──────────────────────────────────────────────
  if (builderOpen) {
    return (
      <CardBuilderModal
        existingDesign={editingDesign}
        onClose={handleBuilderClose}
        onSaved={handleDesignSaved}
      />
    );
  }

  // ── Template editor view ────────────────────────────────────────────────────
  if (selectedTemplate) {
    return (
      <div className="space-y-6">
        <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                Template Editor
              </p>
              <h2 className="mt-1 text-2xl font-black text-slate-900">
                {selectedTemplate.name}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSelectedTemplate(null)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              Back to Cards
            </button>
          </div>
          <div className="mt-6">
            <AdvancedTemplateCard
              template={selectedTemplate}
              onTemplateChange={(template) => setSelectedTemplate(template)}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Main gallery view ───────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-black text-slate-900">Cards</h1>
          <p className="mt-2 text-base text-slate-600">
            Design social media cards from scratch or start from a template.
          </p>
        </div>
        <button
          type="button"
          onClick={openNewDesign}
          className="flex shrink-0 items-center gap-2 rounded-2xl bg-[#e6332a] px-5 py-3 text-sm font-bold text-white shadow-md shadow-red-100 transition hover:bg-[#cc2921] active:scale-[0.98]"
        >
          <Plus size={16} />
          New Design
        </button>
      </header>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8 space-y-10">

        {/* ── My Designs ─────────────────────────────────────────────────────── */}
        <section>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">My Designs</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Your saved canvas designs
              </p>
            </div>
            {myDesigns.length > 0 && (
              <button
                type="button"
                onClick={openNewDesign}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                <Plus size={13} />
                New
              </button>
            )}
          </div>

          {isLoadingDesigns ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="aspect-square animate-pulse bg-slate-100" />
                  <div className="space-y-2 p-3">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : myDesigns.length === 0 ? (
            <button
              type="button"
              onClick={openNewDesign}
              className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 py-16 text-center transition hover:border-[#e6332a]/40 hover:bg-red-50/30"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-[#e6332a]">
                <Plus size={24} />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-700">Create your first design</p>
                <p className="text-xs text-slate-400 mt-1">
                  Start with a blank canvas and design from scratch
                </p>
              </div>
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {myDesigns.map((design) => (
                <DesignThumb
                  key={design.id}
                  design={design}
                  onOpen={() => openDesign(design)}
                  onDelete={() => handleDeleteDesign(design.id)}
                />
              ))}
            </div>
          )}
        </section>

        <hr className="border-slate-200" />

        {/* ── Published templates ─────────────────────────────────────────────── */}
        {!isLoadingTemplates && publishedTemplates.length > 0 && (
          <section>
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-900">Featured Templates</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Curated templates ready to customize
              </p>
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {publishedTemplates.map((template) => (
                <div
                  key={template.id}
                  className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="relative aspect-square overflow-hidden bg-slate-100">
                    {template.coverImageUrl ? (
                      <img
                        src={template.coverImageUrl}
                        alt={template.name}
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-400">
                        <span className="text-sm">No preview</span>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-semibold text-slate-900">{template.name}</h3>
                    {template.description && (
                      <p className="mt-1 text-sm text-slate-500 line-clamp-2">
                        {template.description}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectPublishedTemplate(template)}
                      className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 active:scale-95"
                    >
                      Use Template
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <hr className="mt-10 border-slate-200" />
          </section>
        )}

        {isLoadingTemplates && (
          <section>
            <div className="mb-5 h-6 w-40 animate-pulse rounded-lg bg-slate-200" />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="overflow-hidden rounded-2xl border border-slate-200">
                  <div className="aspect-square animate-pulse bg-slate-100" />
                  <div className="space-y-2 p-4">
                    <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
                    <div className="h-9 w-full animate-pulse rounded-xl bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Prebuilt templates ──────────────────────────────────────────────── */}
        <section>
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-900">
              {publishedTemplates.length > 0 ? 'More Templates' : 'Prebuilt Templates'}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Ready-made designs you can customize instantly
            </p>
          </div>
          <PrebuiltTemplates
            templates={cardTemplates}
            onSelectTemplate={handleSelectTemplate}
          />
        </section>
      </div>
    </div>
  );
};

export default Cards;
