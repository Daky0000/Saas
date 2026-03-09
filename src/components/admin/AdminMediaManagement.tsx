import { Image } from 'lucide-react';

const AdminMediaManagement = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">Media Library</h2>
        <p className="mt-1 text-sm text-slate-500">Manage all platform images, control storage limits, and monitor usage.</p>
      </div>

      <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
        <Image size={40} className="mb-3 text-slate-300" />
        <p className="text-sm font-semibold">Admin Media Management coming soon</p>
        <p className="mt-1 text-xs">View all uploads, configure storage limits, and manage user media.</p>
      </div>
    </div>
  );
};

export default AdminMediaManagement;
