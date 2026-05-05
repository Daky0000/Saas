import { useEffect, useRef, useState } from 'react';
import {
  Calendar, Check, ChevronDown, Download, Flag, Paperclip,
  Plus, Send, Trash2, User, X,
} from 'lucide-react';
import { apiFetch } from '../TasksPage';
import {
  Task, TaskStatus, TaskPriority, Subtask, Comment, TaskLabel,
  ProjectMember, TaskAttachment, QUICK_EMOJIS,
  STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, PRIORITY_LABELS,
} from '../taskTypes';
import { API_BASE_URL } from '../../../utils/apiBase';

type Props = {
  task: Task;
  projectId: string;
  onClose: () => void;
  onUpdated: (t: Task) => void;
  onDeleted: (id: string) => void;
};

function Avatar({ name, avatar, size = 24 }: { name: string; avatar: string | null; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-indigo-600 font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

function tok() { return localStorage.getItem('auth_token') ?? ''; }

export default function TaskDetailPanel({ task: initialTask, projectId, onClose, onUpdated, onDeleted }: Props) {
  const [task, setTask] = useState<Task>(initialTask);
  const [subtasks, setSubtasks] = useState<Subtask[]>(initialTask.subtasks ?? []);
  const [attachments, setAttachments] = useState<TaskAttachment[]>(initialTask.attachments ?? []);
  const [comments, setComments] = useState<Comment[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [labels, setLabels] = useState<TaskLabel[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(task.description);
  const [showAssignPicker, setShowAssignPicker] = useState(false);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [showSupervisorPicker, setShowSupervisorPicker] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newLabelColor, setNewLabelColor] = useState('#6366f1');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (updates: Partial<Task>) => {
    const merged = { ...task, ...updates };
    setTask(merged);
    onUpdated(merged);
    setSaving(true);
    try {
      await apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, {
        method: 'PUT', body: JSON.stringify(updates),
      });
    } finally { setSaving(false); }
  };

  const changeStatus = async (status: TaskStatus) => {
    setTask((t) => ({ ...t, status }));
    onUpdated({ ...task, status });
    setShowStatusPicker(false);
    await apiFetch(`/api/projects/${projectId}/tasks/${task.id}/status`, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
  };

  const loadFull = async () => {
    const [taskData, commentsData, membersData, labelsData] = await Promise.all([
      apiFetch<{ task: Task }>(`/api/projects/${projectId}/tasks/${task.id}`),
      apiFetch<{ comments: Comment[] }>(`/api/tasks/${task.id}/comments`),
      apiFetch<{ members: ProjectMember[] }>(`/api/projects/${projectId}/members`),
      apiFetch<{ labels: TaskLabel[] }>(`/api/projects/${projectId}/labels`),
    ]);
    setTask(taskData.task);
    setSubtasks(taskData.task.subtasks ?? []);
    setAttachments(taskData.task.attachments ?? []);
    setComments(commentsData.comments);
    setMembers(membersData.members);
    setLabels(labelsData.labels);
  };

  useEffect(() => { void loadFull(); }, [task.id]);

  // Subtasks
  const addSubtask = async () => {
    if (!newSubtask.trim()) return;
    const d = await apiFetch<{ subtask: Subtask }>(`/api/tasks/${task.id}/subtasks`, {
      method: 'POST', body: JSON.stringify({ title: newSubtask.trim() }),
    });
    setSubtasks((p) => [...p, d.subtask]);
    setNewSubtask('');
    const done = [...subtasks, d.subtask].filter((s) => s.completed).length;
    setTask((t) => ({ ...t, subtask_count: subtasks.length + 1, subtask_done: done }));
  };

  const toggleSubtask = async (s: Subtask) => {
    const updated = { ...s, completed: !s.completed };
    setSubtasks((p) => p.map((x) => (x.id === s.id ? updated : x)));
    await apiFetch(`/api/tasks/${task.id}/subtasks/${s.id}`, {
      method: 'PATCH', body: JSON.stringify({ completed: updated.completed }),
    });
    const arr = subtasks.map((x) => (x.id === s.id ? updated : x));
    setTask((t) => ({ ...t, subtask_done: arr.filter((x) => x.completed).length }));
  };

  const deleteSubtask = async (id: string) => {
    setSubtasks((p) => p.filter((s) => s.id !== id));
    await apiFetch(`/api/tasks/${task.id}/subtasks/${id}`, { method: 'DELETE' });
  };

  // Assignees
  const toggleAssignee = async (member: ProjectMember) => {
    const isAssigned = task.assignees.some((a) => a.user_id === member.id);
    if (isAssigned) {
      setTask((t) => ({ ...t, assignees: t.assignees.filter((a) => a.user_id !== member.id) }));
      await apiFetch(`/api/tasks/${task.id}/assignees/${member.id}`, { method: 'DELETE' });
    } else {
      const newAssignee = { user_id: member.id, name: member.name, avatar: member.avatar_url };
      setTask((t) => ({ ...t, assignees: [...t.assignees, newAssignee] }));
      await apiFetch(`/api/tasks/${task.id}/assignees`, {
        method: 'POST', body: JSON.stringify({ user_id: member.id }),
      });
    }
  };

  // Labels
  const toggleLabel = async (label: TaskLabel) => {
    const isOn = task.labels.some((l) => l.id === label.id);
    if (isOn) {
      setTask((t) => ({ ...t, labels: t.labels.filter((l) => l.id !== label.id) }));
      await apiFetch(`/api/tasks/${task.id}/labels/${label.id}`, { method: 'DELETE' });
    } else {
      setTask((t) => ({ ...t, labels: [...t.labels, label] }));
      await apiFetch(`/api/tasks/${task.id}/labels/${label.id}`, { method: 'POST' });
    }
  };

  const createLabel = async () => {
    if (!newLabel.trim()) return;
    const d = await apiFetch<{ label: TaskLabel }>(`/api/projects/${projectId}/labels`, {
      method: 'POST', body: JSON.stringify({ name: newLabel.trim(), color: newLabelColor }),
    });
    setLabels((p) => [...p, d.label]);
    setNewLabel('');
  };

  // Comments
  const postComment = async () => {
    if (!newComment.trim()) return;
    const d = await apiFetch<{ comment: Comment }>(`/api/tasks/${task.id}/comments`, {
      method: 'POST', body: JSON.stringify({ content: newComment.trim(), parent_id: replyTo?.id }),
    });
    if (replyTo) {
      setComments((p) => p.map((c) => c.id === replyTo.id ? { ...c, replies: [...c.replies, d.comment] } : c));
    } else {
      setComments((p) => [...p, { ...d.comment, reactions: [], replies: [] }]);
    }
    setNewComment('');
    setReplyTo(null);
  };

  const deleteComment = async (commentId: string, parentId?: string) => {
    await apiFetch(`/api/tasks/${task.id}/comments/${commentId}`, { method: 'DELETE' });
    if (parentId) {
      setComments((p) => p.map((c) => c.id === parentId ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) } : c));
    } else {
      setComments((p) => p.filter((c) => c.id !== commentId));
    }
  };

  const toggleReaction = async (commentId: string, emoji: string) => {
    await apiFetch(`/api/tasks/${task.id}/comments/${commentId}/reactions`, {
      method: 'POST', body: JSON.stringify({ emoji }),
    });
    setComments((p) => p.map((c) => {
      if (c.id !== commentId) return c;
      const existing = c.reactions.find((r) => r.emoji === emoji);
      let reactions: typeof c.reactions;
      if (existing) {
        reactions = existing.reacted
          ? c.reactions.map((r) => r.emoji === emoji ? { ...r, count: r.count - 1, reacted: false } : r).filter((r) => r.count > 0)
          : c.reactions.map((r) => r.emoji === emoji ? { ...r, count: r.count + 1, reacted: true } : r);
      } else {
        reactions = [...c.reactions, { emoji, count: 1, reacted: true }];
      }
      return { ...c, reactions };
    }));
  };

  // Attachments
  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${API_BASE_URL}/api/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok()}` },
        body: form,
      });
      const data = await r.json() as { url?: string; name?: string };
      if (!data.url) throw new Error('Upload failed');
      const att = await apiFetch<{ attachment: TaskAttachment }>(`/api/tasks/${task.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ name: file.name, url: data.url, size: file.size, mime_type: file.type }),
      });
      setAttachments((p) => [...p, att.attachment]);
    } finally { setUploading(false); }
  };

  const deleteAttachment = async (id: string) => {
    setAttachments((p) => p.filter((a) => a.id !== id));
    await apiFetch(`/api/tasks/${task.id}/attachments/${id}`, { method: 'DELETE' });
  };

  const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
  const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent'];
  const subtaskProgress = subtasks.length > 0 ? Math.round((subtasks.filter((s) => s.completed).length / subtasks.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-40 flex" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-6 py-4">
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => { setEditingTitle(false); if (titleDraft.trim() !== task.title) void patch({ title: titleDraft.trim() }); }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); } }}
                className="w-full rounded-xl border border-indigo-300 px-3 py-1.5 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            ) : (
              <h2
                role="button" tabIndex={0}
                onClick={() => setEditingTitle(true)}
                className="cursor-text text-lg font-bold text-gray-900 hover:text-indigo-600 transition-colors"
              >
                {task.title}
              </h2>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {/* Status */}
              <div className="relative">
                <button type="button" onClick={() => setShowStatusPicker((v) => !v)}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[task.status]}`}>
                  {STATUS_LABELS[task.status]} <ChevronDown size={10} />
                </button>
                {showStatusPicker && (
                  <div className="absolute left-0 top-7 z-10 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {STATUSES.map((s) => (
                      <button key={s} type="button" onClick={() => void changeStatus(s)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium hover:bg-gray-50 ${task.status === s ? 'text-indigo-600' : 'text-gray-700'}`}>
                        {task.status === s && <Check size={11} />}
                        {task.status !== s && <span className="w-[11px]" />}
                        {STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Priority */}
              <div className="relative">
                <button type="button" onClick={() => setShowPriorityPicker((v) => !v)}
                  className="flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-gray-300">
                  <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[task.priority] }} />
                  {PRIORITY_LABELS[task.priority]} <ChevronDown size={10} />
                </button>
                {showPriorityPicker && (
                  <div className="absolute left-0 top-7 z-10 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    {PRIORITIES.map((p) => (
                      <button key={p} type="button" onClick={() => { setShowPriorityPicker(false); void patch({ priority: p }); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-gray-700 hover:bg-gray-50">
                        <span className="h-2 w-2 rounded-full" style={{ background: PRIORITY_COLORS[p] }} />
                        {PRIORITY_LABELS[p]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {saving && <span className="text-[10px] text-gray-400">saving…</span>}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { if (confirm('Delete this task?')) { void apiFetch(`/api/projects/${projectId}/tasks/${task.id}`, { method: 'DELETE' }).then(() => onDeleted(task.id)); } }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500">
              <Trash2 size={15} />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-3 divide-x divide-gray-100">

            {/* Main content (2/3) */}
            <div className="col-span-2 space-y-5 p-5">

              {/* Description */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Description</p>
                {editingDesc ? (
                  <div>
                    <textarea
                      autoFocus
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={5}
                      className="w-full resize-none rounded-xl border border-indigo-200 p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                    <div className="mt-1.5 flex gap-1.5">
                      <button type="button" onClick={() => { setEditingDesc(false); void patch({ description: descDraft }); }} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">Save</button>
                      <button type="button" onClick={() => { setDescDraft(task.description); setEditingDesc(false); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div role="button" tabIndex={0} onClick={() => setEditingDesc(true)}
                    className="min-h-[60px] cursor-text rounded-xl border border-dashed border-gray-200 p-3 text-sm text-gray-600 hover:border-indigo-200 hover:bg-indigo-50/20">
                    {task.description || <span className="text-gray-400 italic">Click to add description…</span>}
                  </div>
                )}
              </div>

              {/* Subtasks */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                    Subtasks {subtasks.length > 0 && `(${subtasks.filter((s) => s.completed).length}/${subtasks.length})`}
                  </p>
                </div>
                {subtasks.length > 0 && (
                  <div className="mb-2 h-1.5 w-full rounded-full bg-gray-100">
                    <div className="h-1.5 rounded-full bg-indigo-500 transition-all" style={{ width: `${subtaskProgress}%` }} />
                  </div>
                )}
                <div className="space-y-1.5">
                  {subtasks.map((s) => (
                    <div key={s.id} className="group flex items-center gap-2">
                      <button type="button" onClick={() => void toggleSubtask(s)}
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${s.completed ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300 hover:border-indigo-400'}`}>
                        {s.completed && <Check size={10} className="text-white" />}
                      </button>
                      <span className={`flex-1 text-[13px] ${s.completed ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{s.title}</span>
                      <button type="button" onClick={() => void deleteSubtask(s.id)}
                        className="hidden rounded p-0.5 text-gray-300 hover:text-red-400 group-hover:flex">
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex gap-1.5">
                  <input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void addSubtask()}
                    placeholder="Add subtask…"
                    className="flex-1 rounded-xl border border-gray-200 px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button type="button" onClick={() => void addSubtask()} disabled={!newSubtask.trim()}
                    className="rounded-xl bg-indigo-600 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                    <Plus size={13} />
                  </button>
                </div>
              </div>

              {/* Attachments */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Attachments</p>
                <div className="space-y-1.5">
                  {attachments.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                      <Paperclip size={13} className="shrink-0 text-gray-400" />
                      <span className="flex-1 truncate text-[12px] font-medium text-gray-700">{a.name}</span>
                      <a href={a.url} target="_blank" rel="noreferrer" className="rounded p-0.5 text-gray-400 hover:text-indigo-600"><Download size={12} /></a>
                      <button type="button" onClick={() => void deleteAttachment(a.id)} className="rounded p-0.5 text-gray-300 hover:text-red-400"><X size={12} /></button>
                    </div>
                  ))}
                </div>
                <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && void uploadFile(e.target.files[0])} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="mt-2 flex items-center gap-1.5 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-[12px] font-medium text-gray-400 hover:border-indigo-300 hover:text-indigo-600 transition-colors">
                  {uploading ? <span>Uploading…</span> : <><Plus size={12} /> Add attachment</>}
                </button>
              </div>

              {/* Comments */}
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Comments</p>
                <div className="space-y-4">
                  {comments.map((c) => (
                    <div key={c.id}>
                      <div className="flex items-start gap-2.5">
                        <Avatar name={c.author_name} avatar={c.author_avatar} size={28} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="text-[12px] font-bold text-gray-900">{c.author_name}</span>
                            <span className="text-[10px] text-gray-400">{new Date(c.created_at).toLocaleString()}</span>
                          </div>
                          <p className="mt-0.5 rounded-xl rounded-tl-none bg-gray-50 px-3 py-2 text-[13px] text-gray-700">{c.content}</p>
                          {/* Reactions */}
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {c.reactions.map((r) => (
                              <button key={r.emoji} type="button" onClick={() => void toggleReaction(c.id, r.emoji)}
                                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${r.reacted ? 'border-indigo-200 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                                {r.emoji} {r.count}
                              </button>
                            ))}
                            {QUICK_EMOJIS.map((e) => (
                              <button key={e} type="button" onClick={() => void toggleReaction(c.id, e)}
                                className="rounded-full border border-transparent p-0.5 text-[13px] opacity-40 hover:border-gray-200 hover:opacity-100 transition-all">
                                {e}
                              </button>
                            ))}
                            <button type="button" onClick={() => setReplyTo(c)}
                              className="ml-1 text-[11px] font-medium text-gray-400 hover:text-indigo-600">Reply</button>
                            <button type="button" onClick={() => void deleteComment(c.id)}
                              className="ml-1 text-[11px] text-gray-300 hover:text-red-400">Delete</button>
                          </div>
                          {/* Replies */}
                          {c.replies.map((r) => (
                            <div key={r.id} className="mt-2 flex items-start gap-2 pl-2 border-l-2 border-gray-100">
                              <Avatar name={r.author_name} avatar={r.author_avatar} size={22} />
                              <div className="flex-1 min-w-0">
                                <span className="text-[11px] font-bold text-gray-900">{r.author_name}</span>
                                <span className="ml-1.5 text-[10px] text-gray-400">{new Date(r.created_at).toLocaleString()}</span>
                                <p className="mt-0.5 text-[12px] text-gray-700">{r.content}</p>
                              </div>
                              <button type="button" onClick={() => void deleteComment(r.id, c.id)} className="mt-0.5 text-[10px] text-gray-300 hover:text-red-400">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Comment input */}
                {replyTo && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-[12px] text-indigo-600">
                    Replying to <span className="font-bold">{replyTo.author_name}</span>
                    <button type="button" onClick={() => setReplyTo(null)} className="ml-auto"><X size={12} /></button>
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <textarea
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postComment(); } }}
                    placeholder={replyTo ? `Reply to ${replyTo.author_name}…` : 'Write a comment… (Enter to send)'}
                    rows={2}
                    className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <button type="button" onClick={() => void postComment()} disabled={!newComment.trim()}
                    className="self-end rounded-xl bg-indigo-600 p-2.5 text-white hover:bg-indigo-700 disabled:opacity-40">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Sidebar (1/3) */}
            <div className="space-y-5 p-4">

              {/* Assignees */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Assignees</p>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {task.assignees.map((a) => (
                    <div key={a.user_id} className="flex items-center gap-1 rounded-full bg-gray-100 pl-0.5 pr-2 py-0.5">
                      <Avatar name={a.name} avatar={a.avatar} size={18} />
                      <span className="text-[11px] font-medium text-gray-700">{a.name.split(' ')[0]}</span>
                    </div>
                  ))}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setShowAssignPicker((v) => !v)}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[11px] text-gray-400 hover:border-indigo-300 hover:text-indigo-600">
                    <User size={11} /> Assign
                  </button>
                  {showAssignPicker && (
                    <div className="absolute left-0 top-8 z-10 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                      {members.map((m) => {
                        const assigned = task.assignees.some((a) => a.user_id === m.id);
                        return (
                          <button key={m.id} type="button" onClick={() => void toggleAssignee(m)}
                            className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50">
                            <Avatar name={m.name} avatar={m.avatar_url} size={20} />
                            <span className="flex-1 truncate text-[12px] text-gray-700">{m.name}</span>
                            {assigned && <Check size={11} className="text-indigo-600" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Supervisor */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Supervisor</p>
                <div className="relative">
                  <button type="button" onClick={() => setShowSupervisorPicker((v) => !v)}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[12px] text-gray-600 hover:border-indigo-300">
                    {task.supervisor_name ? (
                      <><User size={11} className="text-indigo-500" /> {task.supervisor_name}</>
                    ) : (
                      <><User size={11} /> None</>
                    )}
                    <ChevronDown size={10} className="ml-auto" />
                  </button>
                  {showSupervisorPicker && (
                    <div className="absolute left-0 top-10 z-10 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                      <button type="button" onClick={() => { setShowSupervisorPicker(false); void patch({ supervisor_id: null }); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-[12px] text-gray-400 hover:bg-gray-50">
                        None
                      </button>
                      {members.map((m) => (
                        <button key={m.id} type="button" onClick={() => { setShowSupervisorPicker(false); void patch({ supervisor_id: m.id }); }}
                          className="flex w-full items-center gap-2 px-3 py-2 hover:bg-gray-50">
                          <Avatar name={m.name} avatar={m.avatar_url} size={18} />
                          <span className="flex-1 truncate text-[12px] text-gray-700">{m.name}</span>
                          {task.supervisor_id === m.id && <Check size={11} className="text-indigo-600" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Due date */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Due Date</p>
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-gray-400" />
                  <input
                    type="date"
                    value={task.due_date?.slice(0, 10) ?? ''}
                    onChange={(e) => void patch({ due_date: e.target.value || null })}
                    className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[12px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  {task.due_date && (
                    <button type="button" onClick={() => void patch({ due_date: null })} className="text-gray-300 hover:text-red-400">
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Labels */}
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Labels</p>
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {task.labels.map((l) => (
                    <span key={l.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: l.color }}>
                      {l.name}
                      <button type="button" onClick={() => void toggleLabel(l)} className="opacity-70 hover:opacity-100"><X size={9} /></button>
                    </span>
                  ))}
                </div>
                <div className="relative">
                  <button type="button" onClick={() => setShowLabelPicker((v) => !v)}
                    className="flex items-center gap-1 rounded-lg border border-dashed border-gray-300 px-2.5 py-1 text-[11px] text-gray-400 hover:border-indigo-300 hover:text-indigo-600">
                    <Flag size={11} /> Labels
                  </button>
                  {showLabelPicker && (
                    <div className="absolute left-0 top-8 z-10 w-52 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                      <div className="mb-2 space-y-0.5">
                        {labels.map((l) => {
                          const on = task.labels.some((x) => x.id === l.id);
                          return (
                            <button key={l.id} type="button" onClick={() => void toggleLabel(l)}
                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                              <span className="h-3 w-3 rounded-full shrink-0" style={{ background: l.color }} />
                              <span className="flex-1 text-left text-[12px] text-gray-700">{l.name}</span>
                              {on && <Check size={11} className="text-indigo-600" />}
                            </button>
                          );
                        })}
                      </div>
                      <div className="border-t border-gray-100 pt-2">
                        <p className="mb-1 text-[10px] font-semibold text-gray-400">Create new</p>
                        <div className="flex gap-1">
                          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label name"
                            className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300" />
                          <input type="color" value={newLabelColor} onChange={(e) => setNewLabelColor(e.target.value)}
                            className="h-7 w-7 cursor-pointer rounded-lg border border-gray-200 p-0.5" />
                          <button type="button" onClick={() => void createLabel()} disabled={!newLabel.trim()}
                            className="rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">+</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div className="space-y-1 rounded-xl bg-gray-50 p-3 text-[11px] text-gray-400">
                <p>Created {new Date(task.created_at).toLocaleDateString()}</p>
                <p>Updated {new Date(task.updated_at).toLocaleDateString()}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
