import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const distDir = resolve(rootDir, 'dist');
const distIndex = resolve(distDir, 'index.html');
const distAssets = resolve(distDir, 'assets');
const rootIndex = resolve(rootDir, 'index.html');
const root404 = resolve(rootDir, '404.html');
const rootAssets = resolve(rootDir, 'assets');
const noJekyll = resolve(rootDir, '.nojekyll');

if (!existsSync(distIndex)) {
  throw new Error('dist/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(distAssets)) {
  throw new Error('dist/assets not found. Run the Vite build before syncing.');
}

if (existsSync(rootAssets)) {
  rmSync(rootAssets, { recursive: true, force: true });
}

mkdirSync(rootAssets, { recursive: true });
cpSync(distAssets, rootAssets, { recursive: true });

const assets = readdirSync(rootAssets);
const jsBundle = assets.find((file) => /^index-.*\.js$/.test(file));
const cssBundle = assets.find((file) => /^index-.*\.css$/.test(file));

if (!jsBundle || !cssBundle) {
  throw new Error('Expected built index JS/CSS bundles were not found in dist/assets.');
}

cpSync(resolve(rootAssets, jsBundle), resolve(rootAssets, 'app.js'));
cpSync(resolve(rootAssets, cssBundle), resolve(rootAssets, 'app.css'));

const cacheBust = Date.now().toString();
const rewriteHtml = (html) =>
  html
    .replace(/src="\/assets\/index-[^"]+\.js"/, `src="/assets/app.js?v=${cacheBust}"`)
    .replace(/href="\/assets\/index-[^"]+\.css"/, `href="/assets/app.css?v=${cacheBust}"`);

const builtHtml = readFileSync(distIndex, 'utf8');
const syncedHtml = rewriteHtml(builtHtml);

writeFileSync(rootIndex, syncedHtml, 'utf8');
writeFileSync(root404, syncedHtml, 'utf8');
writeFileSync(noJekyll, '', 'utf8');

console.log(`Synced GitHub Pages root files. Assets copied: ${assets.length}. Stable files: app.js, app.css`);
