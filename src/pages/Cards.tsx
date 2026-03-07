import { useState, useEffect } from 'react';
import AdvancedTemplateCard from '../components/AdvancedTemplateCard';
import PrebuiltTemplates from '../components/PrebuiltTemplates';
import { cardTemplates, cloneCardTemplate } from '../data/cardTemplates';
import { CardTemplate, AdminCardTemplate } from '../types/cardTemplate';
import { cardTemplateService } from '../services/cardTemplateService';

const Cards = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<CardTemplate | null>(null);
  const [publishedTemplates, setPublishedTemplates] = useState<AdminCardTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPublishedTemplates = async () => {
      try {
        setIsLoading(true);
        const templates = await cardTemplateService.getPublishedTemplates();
        setPublishedTemplates(templates);
      } catch (error) {
        console.error('Failed to fetch published templates:', error);
        setPublishedTemplates([]);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchPublishedTemplates();
  }, []);

  const handleSelectTemplate = (template: CardTemplate) => {
    setSelectedTemplate(cloneCardTemplate(template));
  };

  const handleSelectPublishedTemplate = (template: AdminCardTemplate) => {
    setSelectedTemplate(cloneCardTemplate(template.designData));
  };

  return (
    <div className="space-y-6">
      <header className="max-w-3xl">
        <h1 className="text-4xl font-black text-slate-900">Cards</h1>
        <p className="mt-2 text-base text-slate-600">
          Browse social card templates, customize every layer, and export as an image.
        </p>
      </header>

      <div className="rounded-[32px] border border-slate-200 bg-white p-6 md:p-8">
        {!selectedTemplate ? (
          <div className="space-y-10">
            {/* ── Published templates (admin-created) ── */}
            {!isLoading && publishedTemplates.length > 0 && (
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
                      {/* Preview image */}
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

                      {/* Card footer */}
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

            {/* Loading skeleton */}
            {isLoading && (
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

            {/* ── Prebuilt templates ── */}
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
        ) : (
          /* ── Template editor view ── */
          <div className="space-y-6">
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
                Back to Templates
              </button>
            </div>

            <AdvancedTemplateCard
              template={selectedTemplate}
              onTemplateChange={(template) => setSelectedTemplate(template)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Cards;
