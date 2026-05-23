#!/usr/bin/env node
/**
 * Deploy frontend to GitHub Pages via master/docs folder.
 * Run: node scripts/deploy-pages.mjs
 */
import { execSync } from 'child_process';

const run = (cmd) => {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};

console.log('Building frontend...');
run('npm run build --workspace @contentflow/web');

console.log('\nPushing docs/ to master...');
run('npx gh-pages -d packages/web/dist -b master --dest docs -m "deploy: update GitHub Pages"');

console.log('\nDone. GitHub Pages will update in ~1 minute.');
