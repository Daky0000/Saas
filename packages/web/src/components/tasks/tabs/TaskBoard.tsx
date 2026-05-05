import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Task, TaskStatus, STATUS_LABELS } from '../taskTypes';
import TaskCard from '../board/TaskCard';
import { apiFetch } from '../TasksPage';
import { useWorkspace } from '../../../contexts/WorkspaceContext';

type Props = {
  projectId: string;
  tasks: Task[];
  loading: boolean;
  onTasksChange: (tasks: Task[]) => void;
  onOpenTask: (task: Task) => void;
  onReload: () => void;
};

const COLUMNS: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];

const COLUMN_STYLES: Record<TaskStatus, { header: string; dot: string }> = {
  todo: { header: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  in_progress: { header: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  in_review: { header: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  done: { header: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
};

export default function TaskBoard({ projectId, tasks, loading, onTasksChange, onOpenTask, onReload }: Props) {
  const { currentOrg } = useWorkspace();
  const isAdmin = currentOrg?.role === 'owner' || currentOrg?.role === 'admin';

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<TaskStatus | null>(null);
  const [overTaskId, setOverTaskId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const dragTask = useRef<Task | null>(null);

  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s).sort((a, b) => a.position - b.position);

  const handleDragStart = (task: Task) => {
    if (!isAdmin) return;
    dragTask.current = task;
    setDraggingId(task.id);
  };

  const handleDragOver = (e: React.DragEvent, status: TaskStatus, taskId?: string) => {
    e.preventDefault();
    setOverColumn(status);
    setOverTaskId(taskId ?? null);
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault();
    const task = dragTask.current;
    if (!task || !isAdmin) { reset(); return; }

    const col = byStatus(targetStatus).filter((t) => t.id !== task.id);
    const insertAt = overTaskId ? col.findIndex((t) => t.id === overTaskId) : col.length;
    col.splice(insertAt < 0 ? col.length : insertAt, 0, { ...task, status: targetStatus });

    const updates = col.map((t, i) => ({ id: t.id, status: targetStatus, position: i }));
    if (task.status !== targetStatus) {
      updates.push(...byStatus(task.status).filter((t) => t.id !== task.id).map((t, i) => ({ id: t.id, status: task.status, position: i })));
    }

    onTasksChange(tasks.map((t) => {
      const u = updates.find((x) => x.id === t.id);
      return u ? { ...t, status: u.status, position: u.position } : t;
    }));

    try {
      if (task.status !== targetStatus) {
        await apiFetch(`/api/projects/${projectId}/tasks/${task.id}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: targetStatus }),
        });
      }
      await apiFetch(`/api/projects/${projectId}/tasks/reorder`, {
        method: 'PATCH', body: JSON.stringify({ updates }),
      });
    } catch { onReload(); }
    reset();
  };

  const reset = () => { setDraggingId(null); setOverColumn(null); setOverTaskId(null); dragTask.current = null; };

  const createTask = async (status: TaskStatus) => {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const data = await apiFetch<{ task: Task }>(`/api/projects/${projectId}/tasks`, {
        method: 'POST', body: JSON.stringify({ title: newTitle.trim(), status }),
      });
      onTasksChange([...tasks, data.task]);
      setNewTitle('');
      setAddingTo(null);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {COLUMNS.map((s) => (
          <div key={s} className="h-48 animate-pulse rounded-2xl bg-gray-100" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" onDragEnd={reset}>
      {COLUMNS.map((status) => {
        const col = byStatus(status);
        const isOver = overColumn === status;
        return (
          <div
            key={status}
            onDragOver={(e) => handleDragOver(e, status)}
            onDrop={(e) => void handleDrop(e, status)}
            className={`flex flex-col rounded-2xl border transition-colors ${isOver ? 'border-indigo-300 bg-indigo-50/30' : 'border-gray-200 bg-gray-50/50'}`}
          >
            {/* Column header */}
            <div className={`flex items-center gap-2 rounded-t-2xl px-3 py-2.5 ${COLUMN_STYLES[status].header}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${COLUMN_STYLES[status].dot}`} />
              <span className="flex-1 text-[12px] font-bold uppercase tracking-wider">{STATUS_LABELS[status]}</span>
              <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-[11px] font-bold">{col.length}</span>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 p-2 min-h-[120px]">
              {col.map((task) => (
                <div
                  key={task.id}
                  draggable={isAdmin}
                  onDragStart={() => handleDragStart(task)}
                  onDragOver={(e) => handleDragOver(e, status, task.id)}
                  className={`transition-opacity ${draggingId === task.id ? 'opacity-40' : ''}`}
                >
                  <TaskCard task={task} isAdmin={isAdmin} onClick={() => onOpenTask(task)} />
                </div>
              ))}

              {/* Drop indicator */}
              {isOver && draggingId && overColumn === status && !overTaskId && (
                <div className="h-1 w-full rounded-full bg-indigo-400 opacity-60" />
              )}
            </div>

            {/* Add task */}
            <div className="p-2 pt-0">
              {addingTo === status ? (
                <div className="space-y-1.5">
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void createTask(status);
                      if (e.key === 'Escape') { setAddingTo(null); setNewTitle(''); }
                    }}
                    placeholder="Task title…"
                    className="w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  />
                  <div className="flex gap-1">
                    <button type="button" onClick={() => void createTask(status)} disabled={creating || !newTitle.trim()} className="flex-1 rounded-lg bg-indigo-600 py-1.5 text-[12px] font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
                      {creating ? '…' : 'Add'}
                    </button>
                    <button type="button" onClick={() => { setAddingTo(null); setNewTitle(''); }} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] text-gray-500 hover:bg-gray-100">
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingTo(status)}
                  className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-medium text-gray-400 hover:bg-white hover:text-gray-700 transition-colors"
                >
                  <Plus size={13} /> Add task
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
