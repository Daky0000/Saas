import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const docsDir = resolve(rootDir, 'docs');
const docsIndex = resolve(docsDir, 'index.html');
const docsAssets = resolve(docsDir, 'assets');
const docs404 = resolve(docsDir, '404.html');
const noJekyll = resolve(docsDir, '.nojekyll');
const rootAssets = resolve(rootDir, 'assets');
const rootIndex = resolve(rootDir, 'index.html');
const root404 = resolve(rootDir, '404.html');

console.log('Starting post-build sync process for GitHub Pages...');

if (!existsSync(docsIndex)) {
  throw new Error('docs/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(docsAssets)) {
  throw new Error('docs/assets not found. Run the Vite build before syncing.');
}

const assets = readdirSync(docsAssets);
const jsBundle = assets.find((file) => /^index-.*\.js$/.test(file));
const cssBundle = assets.find((file) => /^index-.*\.css$/.test(file));

if (!jsBundle || !cssBundle) {
  throw new Error('Expected built index JS/CSS bundles were not found in docs/assets.');
}

const jsBundlePath = resolve(docsAssets, jsBundle);
const cssBundlePath = resolve(docsAssets, cssBundle);
const finalJsPath = resolve(docsAssets, 'app.js');
const finalCssPath = resolve(docsAssets, 'app.css');

// Rename hashed assets to stable names
cpSync(jsBundlePath, finalJsPath);
cpSync(cssBundlePath, finalCssPath);

// Remove original hashed files
rmSync(jsBundlePath);
rmSync(cssBundlePath);
const jsMap = assets.find(f => f === `${jsBundle}.map`);
if (jsMap) rmSync(resolve(docsAssets, jsMap));
const cssMap = assets.find(f => f === `${cssBundle}.map`);
if (cssMap) rmSync(resolve(docsAssets, cssMap));


const cacheBust = Date.now().toString();
const rewriteHtml = (html) =>
  html
    .replace(/src="\/assets\/index-[^"]+\.js"/, `src="/assets/app.js?v=${cacheBust}"`)
    .replace(/href="\/assets\/index-[^"]+\.css"/, `href="/assets/app.css?v=${cacheBust}"`);

const builtHtml = readFileSync(docsIndex, 'utf8');
const syncedHtml = rewriteHtml(builtHtml);

// Overwrite index.html and create 404.html within docs
writeFileSync(docsIndex, syncedHtml, 'utf8');
writeFileSync(docs404, syncedHtml, 'utf8');
writeFileSync(noJekyll, '', 'utf8');

console.log(`Synced GitHub Pages files within 'docs' directory. Stable files: app.js, app.css`);

// Mirror docs output to repository root for master/root Pages deployments
if (existsSync(rootAssets)) {
  rmSync(rootAssets, { recursive: true, force: true });
}
mkdirSync(rootAssets, { recursive: true });
cpSync(docsAssets, rootAssets, { recursive: true });
writeFileSync(rootIndex, syncedHtml, 'utf8');
writeFileSync(root404, syncedHtml, 'utf8');

console.log(`Mirrored GitHub Pages files to repository root.`);
