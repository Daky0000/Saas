import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, Globe } from 'lucide-react';
import {
  AdminCardTemplate,
  CreateAdminCardTemplateInput,
  CardTemplate,
  createStyleConfig,
} from '../../types/cardTemplate';
import { cardTemplateService } from '../../services/cardTemplateService';
import CardBuilder from './CardBuilder';

const AdminCardsManagement = () => {
  const [templates, setTemplates] = useState<AdminCardTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState<CardTemplate | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CreateAdminCardTemplateInput>({
    name: '',
    description: '',
    designData: createDefaultCardTemplate(),
  });
  const [isSaving, setIsSaving] = useState(false);

  function createDefaultCardTemplate(): CardTemplate {
    return {
      id: 'default',
      name: 'New Template',
      description: '',
      aspectRatio: '1:1',
      background: createStyleConfig({
        backgroundType: 'gradient',
        backgroundGradientFrom: '#1e293b',
        backgroundGradientTo: '#0f172a',
        backgroundGradientAngle: 135,
      }),
      decorations: [],
      elements: [],
    };
  }

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const data = await cardTemplateService.getTemplates();
      setTemplates(data);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load card templates');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchTemplates();
  }, []);

  const openBuilder = (
    template: CardTemplate,
    id: string | null,
    name: string,
    description: string
  ) => {
    setEditingId(id);
    setFormData({ name, description, designData: template });
    setBuilderTemplate(template);
    setIsBuilderOpen(true);
  };

  const handleStartBuilder = () => {
    if (!formData.name.trim()) {
      setErrorMessage('Please enter a template name');
      return;
    }
    setErrorMessage(null);
    setIsFormOpen(false);
    setBuilderTemplate(formData.designData);
    setIsBuilderOpen(true);
  };

  // Save draft — create or update without publishing
  const handleBuilderSave = async (designedTemplate: CardTemplate) => {
    try {
      setIsSaving(true);
      if (editingId) {
        await cardTemplateService.updateTemplate(editingId, {
          name: formData.name,
          description: formData.description,
          designData: designedTemplate,
        });
        setSuccessMessage('Template saved successfully');
      } else {
        const created = await cardTemplateService.createTemplate({
          name: formData.name,
          description: formData.description,
          designData: designedTemplate,
        });
        // Store the new ID so subsequent saves/publishes use it
        setEditingId(created.id);
        setSuccessMessage('Template saved as draft');
      }
      await fetchTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  // Save + publish in one step (called from within the builder toolbar)
  const handleBuilderPublish = async (
    designedTemplate: CardTemplate,
    previewImageUrl: string
  ) => {
    try {
      setIsSaving(true);
      setErrorMessage(null);

      let templateId = editingId;

      // Step 1 — save/update the design first
      if (templateId) {
        await cardTemplateService.updateTemplate(templateId, {
          name: formData.name,
          description: formData.description,
          designData: designedTemplate,
        });
      } else {
        const created = await cardTemplateService.createTemplate({
          name: formData.name,
          description: formData.description,
          designData: designedTemplate,
        });
        templateId = created.id;
        setEditingId(created.id);
      }

      // Step 2 — publish with the uploaded preview image
      await cardTemplateService.publishTemplate(templateId!, { coverImageUrl: previewImageUrl });

      setSuccessMessage(`"${formData.name}" published successfully`);
      setIsBuilderOpen(false);
      setBuilderTemplate(null);
      setEditingId(null);
      setFormData({ name: '', description: '', designData: createDefaultCardTemplate() });
      await fetchTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to publish template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (template: AdminCardTemplate) => {
    openBuilder(template.designData, template.id, template.name, template.description);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this card template? This cannot be undone.')) return;
    try {
      setErrorMessage(null);
      await cardTemplateService.deleteTemplate(id);
      setSuccessMessage('Template deleted');
      await fetchTemplates();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Failed to delete template');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Card Templates</h1>
          <p className="mt-1 text-sm text-slate-500">
            Build and publish templates for the user dashboard.
          </p>
        </div>
        <button
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', description: '', designData: createDefaultCardTemplate() });
            setIsFormOpen(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition"
        >
          <Plus size={18} />
          New Template
        </button>
      </div>

      {/* Publish workflow hint */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm text-blue-800">
        <span className="font-semibold">Publish workflow: </span>
        Build your template in the editor &rarr; click <strong>Download Preview</strong> to export
        the canvas &rarr; click <strong>Upload Preview</strong> to attach the image &rarr; click{' '}
        <strong>Publish Template</strong> to make it live in the user gallery.
      </div>

      {/* Alerts */}
      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          {successMessage}
        </div>
      )}

      {/* Templates grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <div
            key={template.id}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition"
          >
            {/* Preview image */}
            <div className="relative aspect-video bg-slate-100">
              {template.coverImageUrl ? (
                <img
                  src={template.coverImageUrl}
                  alt={template.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-slate-400">
                  <p className="text-sm">No preview image</p>
                </div>
              )}
              {template.isPublished && (
                <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-1 text-xs font-semibold text-white">
                  <Globe size={11} />
                  Published
                </span>
              )}
            </div>

            {/* Card body */}
            <div className="p-4">
              <h3 className="font-semibold text-slate-900">{template.name}</h3>
              {template.description && (
                <p className="mt-1 text-sm text-slate-500 line-clamp-2">{template.description}</p>
              )}
              <p className="mt-2 text-xs text-slate-400">
                Created {new Date(template.createdAt).toLocaleDateString()}
              </p>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => handleEdit(template)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition"
                >
                  <Edit2 size={14} />
                  {template.isPublished ? 'Edit / Re-publish' : 'Edit / Publish'}
                </button>
                <button
                  onClick={() => handleDelete(template.id)}
                  className="flex items-center justify-center rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-500 hover:bg-red-100 transition"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {templates.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 py-16 text-center">
          <p className="text-slate-500">No templates yet — create your first one!</p>
        </div>
      )}

      {/* ── New Template Form Modal ── */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
            <div className="border-b px-6 py-5">
              <h2 className="text-xl font-bold text-slate-900">New Card Template</h2>
              <p className="mt-1 text-sm text-slate-500">
                Name your template, then continue to the design editor.
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleStartBuilder();
              }}
              className="space-y-5 p-6"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Template Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. Motivational Quote Card"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  value={formData.description || ''}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Brief description shown in the template gallery"
                  rows={3}
                />
              </div>

              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
                The next screen opens the full design editor where you can build the template,
                download a preview, and publish it.
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsFormOpen(false)}
                  className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition disabled:opacity-50"
                >
                  Continue to Editor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Card Builder ── */}
      {isBuilderOpen && builderTemplate && (
        <CardBuilder
          template={builderTemplate}
          templateName={formData.name}
          onSave={handleBuilderSave}
          onPublish={handleBuilderPublish}
          onCancel={() => {
            setIsBuilderOpen(false);
            setBuilderTemplate(null);
          }}
          isLoading={isSaving}
        />
      )}
    </div>
  );
};

export default AdminCardsManagement;
