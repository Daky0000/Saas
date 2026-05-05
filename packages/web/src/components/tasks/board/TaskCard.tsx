import { Calendar, MessageSquare } from 'lucide-react';
import { Task, PRIORITY_COLORS, PRIORITY_LABELS } from '../taskTypes';

type Props = {
  task: Task;
  isAdmin: boolean;
  onClick: () => void;
};

function Avatar({ name, avatar, size = 18 }: { name: string; avatar: string | null; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="flex shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white font-bold" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {name[0]?.toUpperCase()}
    </div>
  );
}

export default function TaskCard({ task, isAdmin, onClick }: Props) {
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date();
  const isDueToday = task.due_date && !isOverdue && new Date(task.due_date).toDateString() === new Date().toDateString();
  const hasSubtasks = task.subtask_count > 0;
  const progress = hasSubtasks ? Math.round((task.subtask_done / task.subtask_count) * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`group w-full rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition-all hover:border-indigo-200 hover:shadow-md cursor-pointer ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {/* Priority dot + labels */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: PRIORITY_COLORS[task.priority] }}
          title={PRIORITY_LABELS[task.priority]}
        />
        {task.labels.slice(0, 2).map((l) => (
          <span key={l.id} className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-white" style={{ background: l.color }}>
            {l.name}
          </span>
        ))}
        {task.labels.length > 2 && (
          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
            +{task.labels.length - 2}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-[13px] font-semibold text-gray-900 leading-snug line-clamp-2">{task.title}</p>

      {/* Subtask progress */}
      {hasSubtasks && (
        <div className="mt-2 flex items-center gap-1.5">
          <div className="h-1 flex-1 rounded-full bg-gray-100">
            <div className="h-1 rounded-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-[10px] font-medium text-gray-400">{task.subtask_done}/{task.subtask_count}</span>
        </div>
      )}

      {/* Footer */}
      <div className="mt-2.5 flex items-center justify-between">
        {/* Assignee avatars */}
        <div className="flex -space-x-1.5">
          {task.assignees.slice(0, 3).map((a) => (
            <Avatar key={a.user_id} name={a.name} avatar={a.avatar} size={20} />
          ))}
          {task.assignees.length > 3 && (
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[9px] font-bold text-gray-600 ring-1 ring-white">
              +{task.assignees.length - 3}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Comment count */}
          {task.comment_count > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
              <MessageSquare size={11} />
              {task.comment_count}
            </span>
          )}
          {/* Due date */}
          {task.due_date && (
            <span className={`flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
              isOverdue ? 'bg-red-50 text-red-600' : isDueToday ? 'bg-amber-50 text-amber-600' : 'text-gray-400'
            }`}>
              <Calendar size={10} />
              {new Date(task.due_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
