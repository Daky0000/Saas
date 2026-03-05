import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const sourceIndex = resolve(rootDir, 'index.source.html');
const rootIndex = resolve(rootDir, 'index.html');
const root404 = resolve(rootDir, '404.html');

if (!existsSync(sourceIndex)) {
  throw new Error('index.source.html not found. Cannot prepare Vite entry HTML.');
}

cpSync(sourceIndex, rootIndex);
cpSync(sourceIndex, root404);

console.log('Prepared source index files for Vite.');
