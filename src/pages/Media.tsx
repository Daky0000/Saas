import { Image } from 'lucide-react';

const Media = () => {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Media Library</h1>
        <p className="mt-1 text-sm text-slate-500">Upload and manage all your images in one place.</p>
      </div>

      <div className="flex h-80 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white text-slate-400">
        <Image size={40} className="mb-3 text-slate-300" />
        <p className="text-sm font-semibold">Media Library coming soon</p>
        <p className="mt-1 text-xs">Upload, organize and reuse images across the platform.</p>
      </div>
    </div>
  );
};

export default Media;
