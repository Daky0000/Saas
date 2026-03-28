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
const buildDir = resolve(rootDir, 'dist');
const buildIndex = resolve(buildDir, 'index.html');
const buildAssets = resolve(buildDir, 'assets');
const build404 = resolve(buildDir, '404.html');
const buildNoJekyll = resolve(buildDir, '.nojekyll');
const docsDir = resolve(rootDir, 'docs');
const rootAssets = resolve(rootDir, 'assets');
const rootIndex = resolve(rootDir, 'index.html');
const root404 = resolve(rootDir, '404.html');
const rootCname = resolve(rootDir, 'CNAME');

console.log('Starting post-build sync process for GitHub Pages...');

if (!existsSync(buildIndex)) {
  throw new Error('dist/index.html not found. Run the Vite build before syncing.');
}

if (!existsSync(buildAssets)) {
  throw new Error('dist/assets not found. Run the Vite build before syncing.');
}

const assets = readdirSync(buildAssets);
const jsBundle = assets.find((file) => /^index-.*\.js$/.test(file));
const cssBundle = assets.find((file) => /^index-.*\.css$/.test(file));

if (!jsBundle || !cssBundle) {
  throw new Error('Expected built index JS/CSS bundles were not found in dist/assets.');
}

const jsBundlePath = resolve(buildAssets, jsBundle);
const cssBundlePath = resolve(buildAssets, cssBundle);
const finalJsPath = resolve(buildAssets, 'app.js');
const finalCssPath = resolve(buildAssets, 'app.css');

// Rename hashed assets to stable names
cpSync(jsBundlePath, finalJsPath);
cpSync(cssBundlePath, finalCssPath);

// Remove original hashed files
rmSync(jsBundlePath);
rmSync(cssBundlePath);
const jsMap = assets.find(f => f === `${jsBundle}.map`);
if (jsMap) rmSync(resolve(buildAssets, jsMap));
const cssMap = assets.find(f => f === `${cssBundle}.map`);
if (cssMap) rmSync(resolve(buildAssets, cssMap));


const rewriteHtml = (html) =>
  html
    .replace(/src="\/assets\/[^"]+\.js(\?[^"]*)?"/g, `src="/assets/app.js"`)
    .replace(/href="\/assets\/[^"]+\.css(\?[^"]*)?"/g, `href="/assets/app.css"`);

const builtHtml = readFileSync(buildIndex, 'utf8');
const syncedHtml = rewriteHtml(builtHtml);

// Overwrite dist output with stable entry files
writeFileSync(buildIndex, syncedHtml, 'utf8');
writeFileSync(build404, syncedHtml, 'utf8');
writeFileSync(buildNoJekyll, '', 'utf8');

if (existsSync(rootCname)) {
  cpSync(rootCname, resolve(buildDir, 'CNAME'));
}

console.log(`Synced GitHub Pages files within 'dist' directory. Stable files: app.js, app.css`);

const mirrorStaticSite = (targetDir, label) => {
  const targetAssets = resolve(targetDir, 'assets');
  const targetIndex = resolve(targetDir, 'index.html');
  const target404 = resolve(targetDir, '404.html');
  const targetNoJekyll = resolve(targetDir, '.nojekyll');

  if (existsSync(targetAssets)) {
    rmSync(targetAssets, { recursive: true, force: true });
  }

  mkdirSync(targetAssets, { recursive: true });
  cpSync(buildAssets, targetAssets, { recursive: true });
  writeFileSync(targetIndex, syncedHtml, 'utf8');
  writeFileSync(target404, syncedHtml, 'utf8');
  writeFileSync(targetNoJekyll, '', 'utf8');

  if (existsSync(rootCname) && resolve(targetDir, 'CNAME') !== rootCname) {
    cpSync(rootCname, resolve(targetDir, 'CNAME'));
  }

  console.log(`Mirrored GitHub Pages files to ${label}.`);
};

mirrorStaticSite(docsDir, "'docs' directory");
mirrorStaticSite(rootDir, 'repository root');
