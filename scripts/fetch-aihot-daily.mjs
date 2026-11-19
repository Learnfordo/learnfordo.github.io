#!/usr/bin/env node
/**
 * fetch-aihot-daily.mjs — 从 AIHOT API 抓取每日 AI 快讯，格式化为博客文章并推送
 *
 * 兜底策略：
 * 1. 调 AIHOT v1 daily API (主力, 10s 超时)
 * 2. 失败 → fallback 到 v1 items API (window=24h, 10s 超时)
 * 3. 都失败 → 不写空文件，退出码 1（让定时任务标记失败，不再静默）
 *
 * 注意：AIHOT 已于 2026-10-31 停用 aihot.virxact.com 的 /api/public/* 旧接口，
 * 域名跳转到 aihot.news，接口迁移到 /api/v1/*。旧接口只会返回 404。
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

const AIHOT_BASE = 'https://aihot.news';
const FETCH_TIMEOUT_MS = 10000;

// /api/public/* 有 UA 黑名单，且 v1 要求标识调用方；统一带上浏览器 UA + skill 标识
const AIHOT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 aihot-skill/0.3.0';

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
    const res = await fetch(url, {
      ...options,
      headers: { 'User-Agent': AIHOT_UA, Accept: 'application/json', ...(options.headers || {}) },
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// 主力：v1 latest daily API
async function fetchDaily() {
  console.log('📡 尝试 AIHOT v1 daily API...');
  const res = await fetchWithTimeout(`${AIHOT_BASE}/api/v1/dailies/latest`);
  if (!res.ok) throw new Error(`daily API HTTP ${res.status}`);
  const data = await res.json();
  const report = data.report;
  if (!report || !report.sections || report.sections.length === 0) {
    throw new Error('daily API 返回空 sections');
  }
  return { source: 'daily', data: report };
}

// fallback：v1 items API (过去24小时精选)
async function fetchItems24h() {
  console.log('📡 fallback 到 AIHOT v1 items API (24h)...');
  const url = `${AIHOT_BASE}/api/v1/items?mode=selected&window=24h&limit=50`;
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
      source: item.source?.name || '',
      url: item.links?.original || '',
      permalink: item.links?.original || item.links?.aihot || '', // 优先原帖链接
    }));
  }
  // 快讯
  const flashes = (data.flashes || []).map(f => ({
    title: f.title || '',
    summary: '',
    source: f.source?.name || '',
    url: f.links?.original || '',
    permalink: f.links?.original || f.links?.aihot || '', // 优先原帖链接
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
      permalink: item.links?.original || item.links?.aihot || '', // 优先原帖链接
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
  md += `\n*本文由 [AIHOT](https://aihot.news) 提供数据支持，每日自动生成。*\n`;

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
      console.log('🚫 AIHOT 不可达，跳过本次（退出码 1，让定时任务报错可见）');
      process.exit(1);
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
