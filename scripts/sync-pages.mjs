import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rootDir = resolve(process.cwd());
const distDir = resolve(rootDir, 'dist');
const distIndex = resolve(distDir, 'index.html');
const distAssets = resolve(distDir, 'assets');
const dist404 = resolve(distDir, '404.html');
const noJekyll = resolve(distDir, '.nojekyll');

console.log('Starting post-build sync process for GitHub Pages...');

if (!existsSync(distIndex)) {
  throw new Error('dist/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(distAssets)) {
  throw new Error('dist/assets not found. Run the Vite build before syncing.');
}

const assets = readdirSync(distAssets);
const jsBundle = assets.find((file) => /^index-.*\.js$/.test(file));
const cssBundle = assets.find((file) => /^index-.*\.css$/.test(file));

if (!jsBundle || !cssBundle) {
  throw new Error('Expected built index JS/CSS bundles were not found in dist/assets.');
}

const jsBundlePath = resolve(distAssets, jsBundle);
const cssBundlePath = resolve(distAssets, cssBundle);
const finalJsPath = resolve(distAssets, 'app.js');
const finalCssPath = resolve(distAssets, 'app.css');

// Rename hashed assets to stable names
cpSync(jsBundlePath, finalJsPath);
cpSync(cssBundlePath, finalCssPath);

// Remove original hashed files
rmSync(jsBundlePath);
rmSync(cssBundlePath);
const jsMap = assets.find(f => f === `${jsBundle}.map`);
if (jsMap) rmSync(resolve(distAssets, jsMap));
const cssMap = assets.find(f => f === `${cssBundle}.map`);
if (cssMap) rmSync(resolve(distAssets, cssMap));


const cacheBust = Date.now().toString();
const rewriteHtml = (html) =>
  html
    .replace(/src="\/assets\/index-[^"]+\.js"/, `src="/assets/app.js?v=${cacheBust}"`)
    .replace(/href="\/assets\/index-[^"]+\.css"/, `href="/assets/app.css?v=${cacheBust}"`);

const builtHtml = readFileSync(distIndex, 'utf8');
const syncedHtml = rewriteHtml(builtHtml);

// Overwrite index.html and create 404.html within dist
writeFileSync(distIndex, syncedHtml, 'utf8');
writeFileSync(dist404, syncedHtml, 'utf8');
writeFileSync(noJekyll, '', 'utf8');

console.log(`Synced GitHub Pages files within 'dist' directory. Stable files: app.js, app.css`);
