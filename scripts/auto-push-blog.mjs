#!/usr/bin/env node
/**
 * auto-push-blog.mjs — 每日自动检查新文章并推送到博客
 * 
 * 用法: node scripts/auto-push-blog.mjs
 * 
 * 流程：
 * 1. 检查 articles/ 下是否有新的 draft-body.html
 * 2. 运行 html2md.py 转换
 * 3. git add + commit + push → 触发 GitHub Actions 部署
 */

import { execSync } from 'child_process';
import { readdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ARTICLES_DIR = '/Users/gaojiaqiang/.openclaw/workspace/articles';
const BLOG_DIR = '/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/content/blog';

console.log('📡 检查新文章...');

// 1. 找到有 draft-body.html 但还没有对应博客 md 的文章
const newArticles = [];
const existingBlogs = new Set(readdirSync(BLOG_DIR).filter(f => f.endsWith('.md')));

for (const dirname of readdirSync(ARTICLES_DIR)) {
  const fullDir = join(ARTICLES_DIR, dirname);
  if (!existsSync(fullDir) || !existsSync(join(fullDir, 'draft-body.html'))) continue;
  
  const slug = dirname.split('_20')[0]
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .toLowerCase() + '.md';
  
  if (!existingBlogs.has(slug)) {
    newArticles.push({ dirname, slug });
  }
}

if (newArticles.length === 0) {
  console.log('✅ 没有新文章需要推送');
  process.exit(0);
}

console.log(`📝 发现 ${newArticles.length} 篇新文章：`);
newArticles.forEach(a => console.log(`  • ${a.dirname}`));

// 2. 运行转换
console.log('\n🔄 转换 HTML 到 Markdown...');
try {
  const result = execSync('cd /Users/gaojiaqiang/.openclaw/workspace/learnfordo-site && python3 scripts/html2md.py 2>&1', { encoding: 'utf-8' });
  console.log(result);
} catch (e) {
  console.error('❌ 转换失败:', e.message);
  process.exit(1);
}

// 3. Git push
console.log('\n🚀 推送到博客...');
try {
  execSync('cd /Users/gaojiaqiang/.openclaw/workspace/learnfordo-site && git add -A', { encoding: 'utf-8' });
  
  // Check if there are changes
  const status = execSync('git diff --cached --shortstat 2>&1', { encoding: 'utf-8' });
  if (!status.trim()) {
    console.log('✅ 没有变更需要提交');
    process.exit(0);
  }
  
  const articleNames = newArticles.map(a => a.dirname.split('_20')[0]).join(', ');
  execSync(`git commit -m "feat: 新文章推送 - ${articleNames}"`, { encoding: 'utf-8' });
  
  try {
    execSync('git push origin main 2>&1', { encoding: 'utf-8', timeout: 30000 });
  } catch (e) {
    // If push fails due to conflict, try pull + rebase
    execSync('git pull --rebase origin main 2>&1', { encoding: 'utf-8', timeout: 30000 });
    execSync('git push origin main 2>&1', { encoding: 'utf-8', timeout: 30000 });
  }
  
  console.log(`✅ 已推送 ${newArticles.length} 篇文章到博客！`);
  console.log('🌐 https://learnfordo.github.io/blog/');
} catch (e) {
  console.error('❌ 推送失败:', e.message);
  process.exit(1);
}
