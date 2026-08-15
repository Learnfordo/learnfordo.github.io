#!/usr/bin/env node
/**
 * fetch-aihot-daily.mjs — 从 AIHOT API 抓取每日 AI 快讯，格式化为博客文章并推送
 *
 * 兜底策略：
 * 1. 调 AIHOT daily API (主力, 10s 超时)
 * 2. 失败 → fallback 到 items API v1 (since=24h, 10s 超时)
 * 3. 都失败 → 跳过本次，退出码 0，不写空文件
 *
 * 用法: node scripts/fetch-aihot-daily.mjs
 */

import { writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(__dirname, '..', 'src', 'content', 'blog');
const SITE_DIR = join(__dirname, '..');

const AIHOT_BASE = 'https://aihot.virxact.com';
const FETCH_TIMEOUT_MS = 10000;

// 北京时间日期
const now = new Date();
const beijingOffset = 8 * 60 * 60 * 1000;
const beijingNow = new Date(now.getTime() + beijingOffset);
const YYYY = beijingNow.getUTCFullYear();
const MM = String(beijingNow.getUTCMonth() + 1).padStart(2, '0');
const DD = String(beijingNow.getUTCDate()).padStart(2, '0');
const todayStr = `${YYYY}-${MM}-${DD}`;
const filename = `daily-ai-${todayStr}.md`;
const filepath = join(BLOG_DIR, filename);

// 分类映射
const CATEGORY_TO_LABEL = {
  'ai-models': '模型发布/更新',
  'ai-products': '产品发布/更新',
  'industry': '行业动态',
  'paper': '论文研究',
  'tip': '技巧与观点',
};

const SECTION_EMOJI = {
  '模型发布/更新': '🤖',
  '产品发布/更新': '🚀',
  '行业动态': '📰',
  '论文研究': '📚',
  '技巧与观点': '💡',
};

const SECTION_ORDER = ['模型发布/更新', '产品发布/更新', '行业动态', '论文研究', '技巧与观点'];

// ============ 数据获取 ============

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 主力：daily API
async function fetchDaily() {
  console.log('📡 尝试 AIHOT daily API...');
  const res = await fetchWithTimeout(`${AIHOT_BASE}/api/public/daily`);
  if (!res.ok) throw new Error(`daily API HTTP ${res.status}`);
  const data = await res.json();
  if (!data.sections || data.sections.length === 0) throw new Error('daily API 返回空 sections');
  return { source: 'daily', data };
}

// fallback：items API v1 (过去24小时精选)
async function fetchItems24h() {
  console.log('📡 fallback 到 AIHOT items API v1 (24h)...');
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const url = `${AIHOT_BASE}/api/v1/items?mode=selected&since=${encodeURIComponent(since)}&limit=50`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`items API HTTP ${res.status}`);
  const data = await res.json();
  if (!data.items || data.items.length === 0) throw new Error('items API 返回空');
  return { source: 'items', data };
}

// ============ 格式化 ============

// 从 daily API 数据提取统一格式
function parseDaily(data) {
  const sections = {};
  for (const section of data.sections) {
    sections[section.label] = (section.items || []).map(item => ({
      title: item.title || '',
      summary: item.summary || '',
      source: item.sourceName || '',
      url: item.sourceUrl || '',
      permalink: item.permalink || item.sourceUrl || '',
    }));
  }
  // 快讯
  const flashes = (data.flashes || []).map(f => ({
    title: f.title || '',
    summary: '',
    source: f.sourceName || '',
    url: f.sourceUrl || '',
    permalink: f.permalink || f.sourceUrl || '',
    isFlash: true,
  }));
  if (flashes.length > 0) {
    sections['快讯'] = flashes;
  }
  return sections;
}

// 从 items API 数据提取统一格式（按 category 分组）
function parseItems(data) {
  const sections = {};
  for (const item of data.items) {
    const label = CATEGORY_TO_LABEL[item.category] || '其他';
    if (!sections[label]) sections[label] = [];
    sections[label].push({
      title: item.title || '',
      summary: item.summary || '',
      source: item.source?.name || '',
      url: item.links?.original || '',
      permalink: item.links?.aihot || item.links?.original || '',
    });
  }
  return sections;
}

// 生成 description（取前3条标题拼接）
function generateDescription(sections) {
  const allItems = SECTION_ORDER
    .filter(s => sections[s])
    .flatMap(s => sections[s].filter(i => !i.isFlash));
  const top3 = allItems.slice(0, 3).map(i => {
    const t = i.title.length > 30 ? i.title.substring(0, 30) + '...' : i.title;
    return t;
  });
  return top3.join('、') || '今日 AI 圈动态';
}

// 格式化为博客 markdown
function formatBlog(sections, sourceType) {
  let description = generateDescription(sections);
  let md = '';
  let counter = 0;
  let totalItems = 0;

  // frontmatter
  md += `---\n`;
  md += `title: 'AI 每日快讯 | ${todayStr}'\n`;
  md += `description: '${description.replace(/'/g, "\\'")}'\n`;
  md += `pubDate: ${todayStr}T12:30:00+08:00\n`;
  md += `tags: ['AI', '每日快讯', 'LLM', 'OpenAI', 'arXiv']\n`;
  md += `---\n\n`;

  // sections
  const allLabels = [...SECTION_ORDER, '快讯'].filter(l => sections[l] && sections[l].length > 0);

  for (const label of allLabels) {
    const emoji = SECTION_EMOJI[label] || '📌';
    const items = sections[label];
    totalItems += items.length;
    md += `## ${emoji} ${label}\n\n`;

    for (const item of items) {
      counter++;
      if (item.isFlash) {
        // 快讯格式：简短一行
        md += `- **${item.title}** — ${item.source}（[${item.permalink}](${item.permalink})）\n`;
      } else {
        md += `### ${counter}. **${item.title}** — ${item.source}\n\n`;
        if (item.summary) {
          md += `${item.summary}\n\n`;
        }
        md += `[阅读全文](${item.permalink})\n\n`;
      }
    }
    md += `---\n\n`;
  }

  // footer
  md += `\n*本文由 [AIHOT](https://aihot.virxact.com) 提供数据支持，每日自动生成。*\n`;

  console.log(`📝 格式化完成：${totalItems} 条，来源 ${sourceType}`);
  return md;
}

// ============ Git 推送 ============

function gitPush() {
  try {
    execSync(`git add "${filepath}"`, { cwd: SITE_DIR, stdio: 'pipe' });
    const status = execSync('git diff --cached --shortstat 2>&1', { cwd: SITE_DIR, encoding: 'utf-8' });
    if (!status.trim()) {
      console.log('✅ 没有变更需要提交');
      return;
    }
    execSync(`git commit -m "daily: AI 每日快讯 ${todayStr}"`, { cwd: SITE_DIR, stdio: 'pipe' });
    try {
      execSync('git push origin main', { cwd: SITE_DIR, encoding: 'utf-8', timeout: 30000 });
      console.log('📤 已推送到 GitHub');
    } catch (e) {
      console.log('🔄 push 失败，尝试 pull --rebase...');
      execSync('git pull --rebase origin main', { cwd: SITE_DIR, encoding: 'utf-8', timeout: 30000 });
      execSync('git push origin main', { cwd: SITE_DIR, encoding: 'utf-8', timeout: 30000 });
      console.log('📤 rebase 后推送成功');
    }
  } catch (e) {
    console.error('❌ Git 推送失败:', e.message);
    // 不 throw，文件已写入，下次再推
  }
}

// ============ 主流程 ============

async function main() {
  console.log(`📰 AIHOT 每日快讯 — ${todayStr}\n`);

  // 检查今天是否已有文章
  if (existsSync(filepath)) {
    console.log(`✅ 今天文章已存在: ${filename}，跳过`);
    process.exit(0);
  }

  let result;
  try {
    result = await fetchDaily();
  } catch (e) {
    console.error(`⚠️ daily API 失败: ${e.message}`);
    try {
      result = await fetchItems24h();
    } catch (e2) {
      console.error(`⚠️ items API 也失败: ${e2.message}`);
      console.log('🚫 AIHOT 不可达，跳过本次（退出码 0）');
      process.exit(0); // 不报错，下次再来
    }
  }

  // 解析数据
  const sections = result.source === 'daily'
    ? parseDaily(result.data)
    : parseItems(result.data);

  const totalItems = Object.values(sections).flat().length;
  if (totalItems === 0) {
    console.log('🚫 AIHOT 返回数据为空，跳过本次');
    process.exit(0);
  }

  // 格式化
  const markdown = formatBlog(sections, result.source);

  // 写文件
  writeFileSync(filepath, markdown, 'utf-8');
  console.log(`✅ 已写入: ${filename}`);

  // Git 推送
  gitPush();

  console.log(`\n📊 汇总：${totalItems} 条，数据来源 ${result.source}`);
}

main().catch(e => {
  console.error('❌ 未预期错误:', e.message);
  process.exit(0); // 兜底：任何错误都不报错
});
