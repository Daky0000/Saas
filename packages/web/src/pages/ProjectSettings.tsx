import { useEffect, useRef, useState } from 'react';
import { Save, Trash2, AlertTriangle } from 'lucide-react';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { API_BASE_URL } from '../utils/apiBase';

const COLORS = [
  '#6366f1', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f97316', '#64748b',
];

export default function ProjectSettings() {
  const { currentProject, currentOrg, refresh } = useWorkspace();
  const [name, setName] = useState(currentProject?.name ?? '');
  const [description, setDescription] = useState(currentProject?.description ?? '');
  const [color, setColor] = useState(currentProject?.color ?? '#6366f1');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentProject) {
      setName(currentProject.name);
      setDescription((currentProject as any).description ?? '');
      setColor(currentProject.color ?? '#6366f1');
    }
  }, [currentProject?.id]);

  if (!currentProject || !currentOrg) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white">
        <p className="text-sm text-gray-400">Select a project to view its settings</p>
      </div>
    );
  }

  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin';
  const token = () => localStorage.getItem('auth_token') ?? '';

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      const r = await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects/${currentProject.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ name: name.trim(), description, color }),
      });
      if (!r.ok) throw new Error('Failed to save');
      await refresh();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async () => {
    setDeleting(true);
    try {
      await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects/${currentProject.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token()}` },
      });
      await refresh();
      window.history.pushState({}, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-black text-white"
            style={{ background: color }}>
            {name[0]?.toUpperCase() ?? 'P'}
          </span>
          <h1 className="text-xl font-black text-gray-900">{currentProject.name}</h1>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">General Settings</span>
        </div>
        <p className="text-sm text-gray-400">Manage this project's name, color, and other settings.</p>
      </div>

      {/* Main settings card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6 space-y-5">
        <h2 className="text-[13px] font-bold text-gray-700 uppercase tracking-wider">Project Info</h2>

        {/* Name */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Project Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!isAdmin}
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-[14px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50 disabled:text-gray-500"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!isAdmin}
            rows={3}
            placeholder="What is this project about?"
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-[13px] text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 disabled:bg-gray-50"
          />
        </div>

        {/* Color */}
        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Project Color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                disabled={!isAdmin}
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full border-2 transition-transform ${color === c ? 'border-gray-900 scale-110' : 'border-transparent hover:scale-110'}`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              disabled={!isAdmin}
              onChange={(e) => setColor(e.target.value)}
              className="h-8 w-8 cursor-pointer rounded-full border border-gray-200 p-0.5"
              title="Custom color"
            />
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-red-500">{error}</p>
        )}

        {isAdmin && (
          <button type="button" onClick={() => void save()} disabled={saving || !name.trim()}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-[13px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            <Save size={14} />
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Meta info */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2 text-[12px] text-gray-500">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Project Info</h2>
        <p><span className="font-semibold text-gray-700">Project ID:</span> {currentProject.id}</p>
        <p><span className="font-semibold text-gray-700">Organisation:</span> {currentOrg.name}</p>
        <p><span className="font-semibold text-gray-700">Your Role:</span> {currentOrg.role}</p>
      </div>

      {/* Danger zone */}
      {isAdmin && (
        <div className="rounded-2xl border border-red-200 bg-white p-5">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-red-500">Danger Zone</h2>
          {!confirmDelete ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-gray-800">Delete this project</p>
                <p className="text-[12px] text-gray-400">Permanently removes the project and all its tasks.</p>
              </div>
              <button type="button" onClick={() => { setConfirmDelete(true); setTimeout(() => deleteInputRef.current?.focus(), 50); }}
                className="rounded-xl border border-red-300 px-4 py-2 text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors">
                Delete Project
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[12px] text-red-600">
                <AlertTriangle size={14} />
                Type <strong className="mx-1">"{currentProject.name}"</strong> to confirm deletion
              </div>
              <input ref={deleteInputRef} type="text" placeholder={currentProject.name}
                className="w-full rounded-xl border border-red-300 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-red-300"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value === currentProject.name) void deleteProject();
                  if (e.key === 'Escape') setConfirmDelete(false);
                }}
              />
              <div className="flex gap-2">
                <button type="button" onClick={deleteProject} disabled={deleting}
                  className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-red-700 disabled:opacity-40">
                  <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button type="button" onClick={() => setConfirmDelete(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-[13px] text-gray-600 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
