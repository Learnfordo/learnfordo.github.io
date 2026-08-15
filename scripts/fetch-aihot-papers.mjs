#!/usr/bin/env node
/**
 * fetch-aihot-papers.mjs — 从 AIHOT API 抓取 AI 论文，合并到 papers.json 并推送
 *
 * 兜底策略：
 * 1. 调 AIHOT items API v1, category=paper (主力, 10s 超时)
 * 2. 失败 → fallback 到原 fetch-papers.mjs (博查 + arXiv)
 * 3. 都失败 → 跳过本次，退出码 0
 *
 * 用法: node scripts/fetch-aihot-papers.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = join(__dirname, '..');
const OUTPUT_PATH = join(SITE_DIR, 'src', 'data', 'papers.json');

const AIHOT_BASE = 'https://aihot.virxact.com';
const FETCH_TIMEOUT_MS = 10000;

// ============ 数据获取 ============

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 主力：AIHOT items API v1, paper 分类
async function fetchAIHotPapers() {
  console.log('📡 尝试 AIHOT items API v1 (paper)...');
  const url = `${AIHOT_BASE}/api/v1/items?mode=selected&category=paper&limit=50`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`AIHOT API HTTP ${res.status}`);
  const data = await res.json();
  if (!data.items || data.items.length === 0) throw new Error('AIHOT 返回空');
  return data.items;
}

// fallback：原 fetch-papers.mjs
async function fallbackFetchPapers() {
  console.log('📡 fallback 到原 fetch-papers.mjs (博查 + arXiv)...');
  const { execSync } = await import('child_process');
  try {
    execSync('node scripts/fetch-papers.mjs', {
      cwd: SITE_DIR,
      encoding: 'utf-8',
      timeout: 180000, // 3 分钟
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log('✅ fetch-papers.mjs 完成');
    return null; // 原脚本自己会写 papers.json
  } catch (e) {
    throw new Error(`fetch-papers.mjs 失败: ${e.message}`);
  }
}

// ============ 数据处理 ============

// 从 AIHOT items 提取论文格式
function parseAIHotPapers(items) {
  const papers = [];
  for (const item of items) {
    const title = (item.title || '').trim();
    if (!title || title.length < 10) continue;

    const originalUrl = item.links?.original || '';
    const permalink = item.links?.aihot || originalUrl;

    // 从 URL 提取 arXiv ID
    const arxivMatch = originalUrl.match(/arxiv\.org\/(?:abs|pdf)\/(\d+\.\d+)/i);
    const arxivId = arxivMatch ? arxivMatch[1] : item.id || '';

    // 从 source.name 推断 vendor
    const sourceName = item.source?.name || '';
    let vendor = '';
    if (sourceName.includes('OpenAI')) vendor = 'OpenAI';
    else if (sourceName.includes('Google') || sourceName.includes('DeepMind')) vendor = 'Google DeepMind';
    else if (sourceName.includes('Meta')) vendor = 'Meta';
    else if (sourceName.includes('Anthropic')) vendor = 'Anthropic';
    else if (sourceName.includes('Mistral')) vendor = 'Mistral';
    else if (sourceName.includes('DeepSeek')) vendor = 'DeepSeek';
    else if (sourceName.includes('智谱') || sourceName.includes('GLM')) vendor = '智谱 (GLM)';
    else if (sourceName.includes('Qwen') || sourceName.includes('通义') || sourceName.includes('阿里')) vendor = '阿里 (Qwen)';
    else if (sourceName.includes('百度') || sourceName.includes('ERNIE')) vendor = '百度';
    else if (sourceName.includes('Kimi') || sourceName.includes('Moonshot')) vendor = 'Moonshot (Kimi)';
    else if (sourceName.includes('华为') || sourceName.includes('Pangu')) vendor = '华为';
    else if (sourceName.includes('Microsoft') || sourceName.includes('Phi') || sourceName.includes('BitNet')) vendor = 'Microsoft';
    else vendor = sourceName || '其他';

    // pdfUrl: 优先用 arXiv PDF 链接
    const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : originalUrl;

    // 日期
    const date = (item.publishedAt || '').substring(0, 10);

    papers.push({
      title,
      vendor,
      date,
      arxivId,
      pdfUrl,
      summary: (item.summary || '').substring(0, 300),
      permalink,
      tags: [],
    });
  }
  return papers;
}

// 合并去重（按标题）
function mergePapers(existing, newPapers) {
  const seen = new Set();
  const merged = [];

  // 先放已有
  for (const p of existing) {
    const key = (p.title || '').toLowerCase().trim();
    if (!seen.has(key) && key) {
      seen.add(key);
      merged.push(p);
    }
  }

  // 再加新的
  let added = 0;
  for (const p of newPapers) {
    const key = (p.title || '').toLowerCase().trim();
    if (!seen.has(key) && key) {
      // 补充中文描述（如果没有）
      if (!p.descriptionCn) {
        p.descriptionCn = `《${p.title.substring(0, 80)}》— ${p.vendor} 发布的最新研究论文。`;
      }
      merged.push(p);
      seen.add(key);
      added++;
      console.log(`  ✨ ${p.vendor}: ${p.title.substring(0, 70)}`);
    }
  }

  // 按日期排序
  merged.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  return { merged, added };
}

// ============ Git 推送 ============

function gitPush(added) {
  if (added === 0) {
    console.log('✅ 没有新论文，跳过 git push');
    return;
  }
  try {
    execSync(`git add src/data/papers.json`, { cwd: SITE_DIR, stdio: 'pipe' });
    execSync(`git commit -m "papers: AIHOT 同步 ${added} 篇新论文"`, { cwd: SITE_DIR, stdio: 'pipe' });
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
  }
}

// ============ 主流程 ============

async function main() {
  console.log('📚 AIHOT 论文库同步\n');

  // 尝试 AIHOT
  let papers = null;
  try {
    const items = await fetchAIHotPapers();
    papers = parseAIHotPapers(items);
    console.log(`✅ AIHOT 返回 ${papers.length} 篇论文\n`);
  } catch (e) {
    console.error(`⚠️ AIHOT 失败: ${e.message}`);
    // fallback
    try {
      await fallbackFetchPapers();
      console.log('✅ 原 fetch-papers.mjs 已处理完成');
      process.exit(0);
    } catch (e2) {
      console.error(`⚠️ fallback 也失败: ${e2.message}`);
      console.log('🚫 全部失败，跳过本次（退出码 0）');
      process.exit(0);
    }
  }

  // 加载已有数据
  let existing = [];
  if (existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    } catch (e) { /* ignore */ }
  }

  // 合并去重
  const { merged, added } = mergePapers(existing, papers);
  console.log(`\n📊 合并后: ${merged.length} 篇论文, 新增 ${added} 篇`);

  // 写入
  writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
  console.log(`✅ 已写入 papers.json`);

  // Git 推送
  gitPush(added);
}

main().catch(e => {
  console.error('❌ 未预期错误:', e.message);
  process.exit(0);
});
