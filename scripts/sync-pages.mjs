import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const distDir = resolve(rootDir, 'dist');
const distIndex = resolve(distDir, 'index.html');
const distAssets = resolve(distDir, 'assets');
const rootIndex = resolve(rootDir, 'index.html');
const root404 = resolve(rootDir, '404.html');
const rootAssets = resolve(rootDir, 'assets');

if (!existsSync(distIndex)) {
  throw new Error('dist/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(distAssets)) {
  throw new Error('dist/assets not found. Run the Vite build before syncing.');
}

cpSync(distIndex, rootIndex);
cpSync(distIndex, root404);

if (existsSync(rootAssets)) {
  rmSync(rootAssets, { recursive: true, force: true });
}

mkdirSync(rootAssets, { recursive: true });
cpSync(distAssets, rootAssets, { recursive: true });

const assets = readdirSync(rootAssets);
console.log(`Synced GitHub Pages root files. Assets copied: ${assets.length}`);
