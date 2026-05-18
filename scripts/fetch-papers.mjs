#!/usr/bin/env node
/**
 * fetch-papers.mjs — 抓取 Top 15 AI 厂商新模型论文（技术报告）
 *
 * 策略：博查搜索 → 提取 arXiv 链接 → arXiv API 补充 → 去重合并 → 写入 papers.json
 * 用法: node scripts/fetch-papers.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = `${__dirname}/../src/data/papers.json`;

const BOCHA_API = 'https://api.bochaai.com/v1/web-search';
const BOCHA_KEY = 'sk-5533609bd10042a08413ab35f896efae';

// 搜索关键词：每个厂商的核心模型论文
const SEARCH_QUERIES = [
  { vendor: 'OpenAI', queries: ['GPT-5 system card technical report arxiv', 'OpenAI ZAYA technical report arxiv 2026'] },
  { vendor: 'Google DeepMind', queries: ['Gemini 3 technical report arxiv 2026', 'Gemma 3 technical report arxiv'] },
  { vendor: 'Meta', queries: ['Llama 4 technical report arxiv 2026', 'Meta Llama 4 herd arxiv'] },
  { vendor: 'Anthropic', queries: ['Claude Opus 4 model card technical report arxiv 2026', 'Anthropic Claude 5 technical report'] },
  { vendor: 'Mistral', queries: ['Mistral Large 2026 technical report arxiv', 'Pixtral Large technical report arxiv'] },
  { vendor: 'DeepSeek', queries: ['DeepSeek-V4 technical report arxiv 2026', 'DeepSeek-Prover-V2 technical report arxiv', 'DeepSeek R2 technical report'] },
  { vendor: '智谱 (GLM)', queries: ['GLM-5 technical report arxiv 2026', 'GLM-5.1 arxiv', 'GLM-5V Turbo arxiv'] },
  { vendor: '阿里 (Qwen)', queries: ['Qwen3.6 technical report arxiv 2026', 'Qwen3.5 Omni technical report arxiv'] },
  { vendor: '百度', queries: ['ERNIE 5.0 technical report arxiv 2026', '百度文心 ERNIE 5 arxiv'] },
  { vendor: 'Moonshot (Kimi)', queries: ['Kimi K2 technical report arxiv 2026', 'Kimi k2.6 technical report'] },
  { vendor: '华为', queries: ['Pangu technical report arxiv 2026', '华为盘古 Pangu Embedded arxiv'] },
  { vendor: 'Microsoft', queries: ['Phi-4 reasoning technical report arxiv 2026', 'BitNet 1.58 technical report arxiv', 'Microsoft MAGNET arxiv'] },
];

// 已知真实论文（种子数据）
const KNOWN_PAPERS = [
  { title: "DeepSeek-R1: Incentivizing Reasoning Capability in LLMs via Reinforcement Learning", vendor: "DeepSeek", date: "2025-01-20", pdfUrl: "https://arxiv.org/pdf/2501.12948", summary: "DeepSeek-R1 通过强化学习激发 LLM 推理能力，开源对标 OpenAI o1。" },
  { title: "DeepSeek-V3 Technical Report", vendor: "DeepSeek", date: "2024-12-26", pdfUrl: "https://arxiv.org/pdf/2412.19437", summary: "DeepSeek-V3 技术报告，MoE 架构、MLA 注意力机制、多 Token 预测。" },
  { title: "Qwen2.5 Technical Report", vendor: "阿里 (Qwen)", date: "2025-01-23", pdfUrl: "https://arxiv.org/pdf/2412.15115", summary: "Qwen2.5 系列模型技术报告，涵盖语言、视觉、代码等多个子模型。" },
  { title: "MiniMax-01: Scaling Foundation Models with Lightning Attention", vendor: "MiniMax", date: "2025-01-15", pdfUrl: "https://arxiv.org/pdf/2501.08313", summary: "MiniMax-01 基于 Lightning Attention 的大规模基础模型技术报告。" },
];

// 从博查搜索结果中提取 arXiv 论文信息
function extractArxivFromResults(items, vendor) {
  const papers = [];
  for (const item of items) {
    const url = item.url || '';
    const arxivMatch = url.match(/arxiv\.org\/abs\/(\d+\.\d+)/i) ||
                       url.match(/arxiv\.org\/pdf\/(\d+\.\d+)/i);
    if (!arxivMatch) continue;

    const arxivId = arxivMatch[1];
    const title = (item.name || '').replace(/\s+/g, ' ').trim();
    const snippet = (item.snippet || '').substring(0, 300);
    const datePublished = (item.datePublished || '').substring(0, 10);

    if (!title || title.length < 10) continue;

    papers.push({
      title,
      vendor,
      date: datePublished || '',
      arxivId,
      pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
      summary: snippet,
      tags: [],
    });
  }
  return papers;
}

// 博查搜索
async function bochaSearch(query) {
  try {
    const res = await fetch(BOCHA_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BOCHA_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, count: 10, summary: true }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.error(`  ⚠️ 搜索 "${query}" 失败: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const items = data?.data?.webPages?.value || [];
    return items;
  } catch (e) {
    console.error(`  ⚠️ 搜索 "${query}" 异常: ${e.message}`);
    return [];
  }
}

// arXiv API 搜索（带延迟避免限速）
async function fetchArxiv(query) {
  try {
    const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=3`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'learnfordo-site/1.0' },
    });
    if (!res.ok) return [];

    const text = await res.text();
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    const papers = [];
    let match;

    while ((match = entryRegex.exec(text)) !== null) {
      const entry = match[1];
      const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
      const linkMatch = entry.match(/<link[^>]*href="([^"]*arxiv.org\/abs\/[^"]*)"/);

      if (titleMatch) {
        const title = titleMatch[1].replace(/\s+/g, ' ').trim();
        const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '';
        const published = publishedMatch ? publishedMatch[1].substring(0, 10) : '';
        const arxivUrl = linkMatch ? linkMatch[1] : '';
        const arxivId = arxivUrl ? arxivUrl.split('/abs/').pop() : '';
        const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : '';

        papers.push({ title, vendor: '', date: published, arxivId, pdfUrl, summary, tags: [] });
      }
    }
    return papers;
  } catch (e) {
    console.error(`  ⚠️ arXiv API 异常: ${e.message}`);
    return [];
  }
}

function cnDesc(paper) {
  const title = paper.title || '';
  if (title.includes('GPT-5')) return `《${title}》— OpenAI 最新旗舰大语言模型，涵盖多模态理解、复杂推理、代码生成及安全性评测。`;
  if (title.includes('Gemini 3')) return `《${title}》— Google DeepMind 最新多模态大模型，视觉理解、长上下文推理和 Agent 能力显著提升。`;
  if (title.includes('Gemma 3')) return `《${title}》— Google 开源轻量级大语言模型，支持端侧部署与高效微调。`;
  if (title.includes('Llama 4')) return `《${title}》— Meta 最新开源旗舰模型，MoE 混合专家架构，推理、多语言和编码任务表现优异。`;
  if (title.includes('Claude Opus 4')) return `《${title}》— Anthropic 旗舰安全大语言模型，专注复杂推理、长文本理解和可信 AI 对齐。`;
  if (title.includes('DeepSeek-V4')) return `《${title}》— 深度求索最新旗舰模型，支持百万 Token 超长上下文，多 Token 预测与 MLA 注意力机制大幅提升推理效率。`;
  if (title.includes('DeepSeek-Prover-V2')) return `《${title}》— 深度求索数学定理证明模型，基于强化学习的子目标分解策略，形式化验证取得突破。`;
  if (title.includes('DeepSeek-Prover')) return `《${title}》— 深度求索定理证明大模型，大规模合成数据训练实现自动定理证明。`;
  if (title.includes('DeepSeek-R1')) return `《${title}》— 深度求索推理模型，通过强化学习激发深度推理能力，开源对标 o1。`;
  if (title.includes('DeepSeek')) return `《${title}》— 深度求索最新研究，持续推动开源高效模型边界。`;
  if (title.includes('GLM-5V')) return `《${title}》— 智谱 AI 视觉语言模型，融合视觉理解与语言推理的多模态旗舰。`;
  if (title.includes('GLM-5.1')) return `《${title}》— 智谱 AI 最新大语言模型，增强智能体工程与复杂任务自动处理能力。`;
  if (title.includes('GLM-5')) return `《${title}》— 智谱 AI 旗舰大语言模型，从辅助编码到智能体工程的全面能力升级。`;
  if (title.includes('Qwen3.6')) return `《${title}》— 阿里通义千问最新旗舰模型，推理、编码和多语言性能对标国际顶尖水平。`;
  if (title.includes('Qwen3.5-Omni')) return `《${title}》— 通义千问全模态大模型，统一文本、图像、音频的理解与生成能力。`;
  if (title.includes('Qwen3')) return `《${title}》— 阿里通义千问系列大语言模型，开源 MoE 架构，性能与效率兼顾。`;
  if (title.includes('ERNIE 5')) return `《${title}》— 百度文心最新旗舰大语言模型，知识增强、推理和多模态全面升级。`;
  if (title.includes('Kimi K2')) return `《${title}》— 月之暗面开放智能体架构模型，编码和工具调用能力卓越，专注 Agent 应用场景。`;
  if (title.includes('Pangu Embedded')) return `《${title}》— 华为盘古双系统推理器，融合 System 1 快速直觉与 System 2 深度思考。`;
  if (title.includes('Pangu')) return `《${title}》— 华为盘古系列大语言模型，自研架构赋能多场景 AI 应用。`;
  if (title.includes('Phi-4-reasoning')) return `《${title}》— 微软 Phi-4 推理模型，小参数量实现强大多步推理能力。`;
  if (title.includes('Phi-4')) return `《${title}》— 微软高效小模型系列，以极少参数实现接近大模型的性能。`;
  if (title.includes('BitNet')) return `《${title}》— 微软 1-bit 量化大模型，突破传统精度限制，大幅降低推理成本。`;
  if (title.includes('Mistral Large') || title.includes('Mixtral')) return `《${title}》— Mistral AI 旗舰模型，MoE 架构兼顾性能与效率。`;
  if (title.includes('Pixtral')) return `《${title}》— Mistral AI 多模态视觉语言模型，整合文本与图像理解能力。`;
  if (title.includes('Mistral')) return `《${title}》— Mistral AI 开源大语言模型，欧洲 AI 领域代表性成果。`;
  return `《${title.substring(0,80)}》— ${paper.vendor} 发布的最新研究论文。`;
}

async function main() {
  console.log('📡 抓取 Top 15 AI 厂商新模型论文...\n');

  // 加载已有数据
  let existing = [...KNOWN_PAPERS];
  if (existsSync(OUTPUT_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      for (const p of saved) {
        if (!existing.find(e => e.title === p.title)) existing.push(p);
      }
    } catch (e) { /* ignore */ }
  }

  // 去重
  const seen = new Set();
  const base = [];
  for (const p of existing) {
    if (!seen.has(p.title)) {
      seen.add(p.title);
      base.push(p);
    }
  }

  // Step 1: 博查搜索（主要数据源，国内稳定）
  console.log('🔍 博查搜索 arxiv 论文...\n');
  let added = 0;

  for (const { vendor, queries } of SEARCH_QUERIES) {
    for (const query of queries) {
      const items = await bochaSearch(query);
      const papers = extractArxivFromResults(items, vendor);

      for (const paper of papers) {
        if (!seen.has(paper.title)) {
          paper.descriptionCn = cnDesc(paper);
          base.push(paper);
          seen.add(paper.title);
          added++;
          console.log(`  ✨ ${paper.vendor}: ${paper.title.substring(0, 70)}`);
        }
      }

      // 搜索间隔 1s 避免限速
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Step 2: arXiv API 补充（仅在博查搜索无结果时）
  console.log('\n📡 arXiv API 补充搜索...\n');
  const arxivQueries = [
    'all:"DeepSeek-V4"+AND+all:technical',
    'all:"GLM-5"+AND+all:technical',
    'all:"Qwen3"+AND+all:technical',
    'all:"Kimi K2"+AND+all:technical',
    'all:"Phi-4"+AND+all:technical',
    'all:"Pangu"+AND+all:technical',
    'all:"Llama 4"+AND+all:technical',
  ];

  for (const query of arxivQueries) {
    const papers = await fetchArxiv(query);
    for (const paper of papers) {
      if (!seen.has(paper.title) && paper.title.length > 10) {
        const t = paper.title.toLowerCase();
        if (t.includes('deepseek')) paper.vendor = 'DeepSeek';
        else if (t.includes('glm') || t.includes('chatglm')) paper.vendor = '智谱 (GLM)';
        else if (t.includes('qwen')) paper.vendor = '阿里 (Qwen)';
        else if (t.includes('kimi')) paper.vendor = 'Moonshot (Kimi)';
        else if (t.includes('phi-4') || t.includes('bitnet')) paper.vendor = 'Microsoft';
        else if (t.includes('pangu')) paper.vendor = '华为';
        else if (t.includes('llama 4')) paper.vendor = 'Meta';
        else if (t.includes('gemini')) paper.vendor = 'Google DeepMind';
        else if (t.includes('mistral') || t.includes('mixtral')) paper.vendor = 'Mistral';
        else continue; // skip unknown vendor

        paper.descriptionCn = cnDesc(paper);
        base.push(paper);
        seen.add(paper.title);
        added++;
        console.log(`  ✨ arXiv: ${paper.vendor} - ${paper.title.substring(0, 70)}`);
      }
    }
    // 间隔 3s 避限速
    await new Promise(r => setTimeout(r, 3000));
  }

  // 生成中文简介
  for (const p of base) {
    if (!p.descriptionCn) p.descriptionCn = cnDesc(p);
  }

  base.sort((a, b) => b.date.localeCompare(a.date));

  writeFileSync(OUTPUT_PATH, JSON.stringify(base, null, 2));
  console.log(`\n✅ papers.json: ${base.length} 篇论文, 新增 ${added} 篇`);

  // 如果有新论文，git 提交推送
  if (added > 0) {
    const { execSync } = await import('child_process');
    try {
      execSync('git add src/data/papers.json', { cwd: __dirname + '/..', stdio: 'pipe' });
      execSync("git commit -m 'papers: 新增论文'", { cwd: __dirname + '/..', stdio: 'pipe' });
      execSync('git pull --rebase origin main', { cwd: __dirname + '/..', stdio: 'pipe' });
      execSync('git push origin main', { cwd: __dirname + '/..', stdio: 'pipe' });
      console.log('📤 已推送到 GitHub');
    } catch (e) {
      console.error('Git 推送失败:', e.stderr?.toString()?.substring(0, 200) || e.message);
    }
  }
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });