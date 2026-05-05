import { Bell } from 'lucide-react';

export default function Notifications() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-12">
      <div>
        <div className="flex items-center gap-2">
          <Bell size={20} className="text-indigo-600" />
          <h1 className="text-xl font-black tracking-tight text-gray-900">Notifications</h1>
        </div>
        <p className="mt-0.5 text-sm text-gray-500">Stay updated on your workspace activity</p>
      </div>

      <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-400">
          <Bell size={22} />
        </div>
        <p className="text-sm font-bold text-gray-700">You're all caught up</p>
        <p className="mt-1 text-sm text-gray-400">Notifications about your posts, team activity, and billing will appear here.</p>
      </div>
    </div>
  );
}
