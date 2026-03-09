export interface CompressedImage {
  url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  file_type: string;
  file_size: number;
}

const MAX_DIMENSION = 1920;
const THUMB_SIZE = 300;
const QUALITY = 0.82;
const THUMB_QUALITY = 0.72;

function dataUrlSize(dataUrl: string): number {
  // Approximate byte size from base64 string
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.round((base64.length * 3) / 4);
}

export async function compressImage(file: File): Promise<CompressedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img;

        // Compute scaled dimensions
        let sw = w, sh = h;
        if (sw > MAX_DIMENSION || sh > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / sw, MAX_DIMENSION / sh);
          sw = Math.round(sw * ratio);
          sh = Math.round(sh * ratio);
        }

        // Main canvas
        const canvas = document.createElement('canvas');
        canvas.width = sw;
        canvas.height = sh;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, sw, sh);

        // Prefer WebP, fallback to JPEG
        const outType = 'image/webp';
        const url = canvas.toDataURL(outType, QUALITY);

        // Thumbnail canvas
        const tRatio = Math.min(THUMB_SIZE / sw, THUMB_SIZE / sh);
        const tw = Math.round(sw * tRatio);
        const th = Math.round(sh * tRatio);
        const tc = document.createElement('canvas');
        tc.width = tw;
        tc.height = th;
        tc.getContext('2d')!.drawImage(canvas, 0, 0, tw, th);
        const thumbnail_url = tc.toDataURL('image/jpeg', THUMB_QUALITY);

        resolve({
          url,
          thumbnail_url,
          width: sw,
          height: sh,
          file_type: outType,
          file_size: dataUrlSize(url),
        });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
