#!/usr/bin/env node
/**
 * convert-articles.mjs — 将 articles/ 下的 draft.md 转为 Astro blog posts
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ARTICLES_DIR = '/Users/gaojiaqiang/.openclaw/workspace/articles';
const BLOG_DIR = '/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/content/blog';

// Clear old placeholder posts
const oldPosts = ['first-post.md', 'second-post.md', 'third-post.md', 'markdown-style-guide.md', 'using-mdx.mdx'];
oldPosts.forEach(f => {
  const p = join(BLOG_DIR, f);
  if (existsSync(p)) {
    // Don't delete, just skip
  }
});

const dirs = readdirSync(ARTICLES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name)
  .sort()
  .reverse(); // newest first

let count = 0;

for (const dirName of dirs) {
  const draftPath = join(ARTICLES_DIR, dirName, 'draft.md');
  if (!existsSync(draftPath)) continue;

  const content = readFileSync(draftPath, 'utf-8');
  
  // Extract title from draft.md
  let title = dirName.replace(/_\d{4}-\d{2}-\d{2}$/, '').replace(/_/g, ' ');
  let description = '';
  let body = content;
  
  // Parse frontmatter if exists
  const titleMatch = content.match(/^-?\s*[标题T]itle[^:]*:\s*(.+)$/m);
  if (titleMatch) title = titleMatch[1].trim();
  
  const descMatch = content.match(/^-?\s*[摘描]要|[Ss]ummary[^:]*:\s*(.+)$/m);
  if (descMatch) description = descMatch[1].trim();
  
  // Extract the core content (skip metadata sections)
  const coreMatch = content.match(/## (?:正文|Content|正文内容|Article Body)[\s\S]*/);
  if (coreMatch) {
    body = coreMatch[0];
  }
  
  // Extract date from folder name
  const dateMatch = dirName.match(/(\d{4}-\d{2}-\d{2})/);
  const pubDate = dateMatch ? dateMatch[1] : '2026-04-01';
  
  if (!description) {
    // Generate from first paragraph
    const firstPara = body.match(/(?:^|\n)\s*(.+?)(?:\n\n|$)/);
    description = firstPara ? firstPara[1].substring(0, 150) : title;
  }
  
  // Generate slug
  const slug = dirName
    .replace(/_\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[^\w\u4e00-\u9fff-]/g, '')
    .toLowerCase();
  
  const frontmatter = `---
title: '${title.replace(/'/g, "\\'")}'
description: '${description.replace(/'/g, "\\'").substring(0, 200)}'
pubDate: '${pubDate}'
---

`;
  
  // Clean body - remove HTML slide references, keep markdown
  let cleanBody = body
    .replace(/## Files in this folder[\s\S]*/g, '')
    .replace(/## Slide[\s\S]*?##/g, '##')
    .trim();
  
  const output = frontmatter + cleanBody;
  const outputPath = join(BLOG_DIR, `${slug}.md`);
  
  writeFileSync(outputPath, output, 'utf-8');
  console.log(`  ✅ ${dirName} → ${slug}.md`);
  count++;
}

console.log(`\n✅ Converted ${count} articles`);
