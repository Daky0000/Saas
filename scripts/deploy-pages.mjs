#!/usr/bin/env node
/**
 * Deploy frontend to GitHub Pages (master/docs).
 * Run: node scripts/deploy-pages.mjs
 */
import { execSync } from 'child_process';
import { cpSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dir, '..');
const dist = resolve(root, 'packages/web/dist');
const docs = resolve(root, 'docs');

const run = (cmd, opts = {}) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: root, ...opts });
};

console.log('1. Building frontend...');
run('npm run build --workspace @contentflow/web');

console.log('\n2. Copying dist → docs/...');
if (existsSync(docs)) rmSync(docs, { recursive: true });
cpSync(dist, docs, { recursive: true });

console.log('\n3. Staging and committing docs/...');
run('git add docs/');
run('git commit -m "deploy: update GitHub Pages"');

console.log('\n4. Pushing...');
run('git push origin master');

console.log('\nDone. GitHub Pages will update in ~1 minute.');
