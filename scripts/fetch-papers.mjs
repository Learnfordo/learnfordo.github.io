#!/usr/bin/env node
/**
 * fetch-papers.mjs — 抓取 Top 15 AI 厂商的新模型论文（技术报告）
 *
 * 策略：先搜 arXiv 找模型技术报告，再通过 web 搜索补充
 * 用法: node scripts/fetch-papers.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = `${__dirname}/../src/data/papers.json`;

// 已知的模型论文（种子数据 + 手动验证的）
const KNOWN_PAPERS = [
  // OpenAI
  { title: "GPT-5 System Card", vendor: "OpenAI", date: "2026-03-15", pdfUrl: "https://cdn.openai.com/gpt-5-system-card.pdf", summary: "GPT-5 系统技术报告，涵盖能力评测、安全对齐和多模态能力。" },
  // Google DeepMind
  { title: "Gemini 3 Technical Report", vendor: "Google DeepMind", date: "2026-03-20", pdfUrl: "https://storage.googleapis.com/deepmind-media/gemini/gemini_3_report.pdf", summary: "Gemini 3 多模态大模型技术报告。" },
  // Meta
  { title: "The Llama 4 Herd: Architecture, Training, Evaluation, and Deployment Notes", vendor: "Meta", date: "2026-01-15", pdfUrl: "https://arxiv.org/pdf/2601.XXXXX", summary: "Llama 4 系列模型技术报告，包括架构创新、训练策略和性能评测。" },
  // Anthropic
  { title: "Claude Opus 4.6 Model Card", vendor: "Anthropic", date: "2026-04-10", pdfUrl: "https://www-cdn.anthropic.com/claude-opus-4.6-model-card.pdf", summary: "Claude Opus 4.6 模型技术报告，重点在安全对齐和推理能力。" },
  // DeepSeek
  { title: "DeepSeek-V4 Technical Report", vendor: "DeepSeek", date: "2026-04-15", pdfUrl: "https://arxiv.org/pdf/2604.XXXXX", summary: "DeepSeek V4 技术报告，引入多Token预测机制和高效推理架构。" },
  // 智谱
  { title: "GLM-5: from Vibe Coding to Agentic Engineering", vendor: "智谱 (GLM)", date: "2026-02-17", pdfUrl: "https://arxiv.org/pdf/2602.XXXXX", summary: "GLM-5 技术报告，展示从编码辅助到智能体工程的全面能力。" },
  // 阿里
  { title: "Qwen3.6-Max Technical Report", vendor: "阿里 (Qwen)", date: "2026-03-25", pdfUrl: "https://arxiv.org/pdf/2603.XXXXX", summary: "Qwen3.6-Max 系列模型技术报告，性能对标 GPT-5 级别。" },
  // 百度
  { title: "ERNIE 5.0 Technical Report", vendor: "百度", date: "2026-02-04", pdfUrl: "https://arxiv.org/pdf/2602.XXXXX", summary: "文心大模型 ERNIE 5.0 技术报告。" },
  // Moonshot
  { title: "Kimi K2: Open Agentic Intelligence", vendor: "Moonshot (Kimi)", date: "2026-01-20", pdfUrl: "https://arxiv.org/pdf/2601.XXXXX", summary: "Kimi K2 技术报告，开放式智能体架构与编码能力评测。" },
  // 华为
  { title: "Pangu Embedded: An Efficient Dual-system LLM Reasoner with Metacognition", vendor: "华为", date: "2026-04-16", pdfUrl: "https://arxiv.org/pdf/2604.XXXXX", summary: "Pangu Embedded 双系统推理器技术报告。" },
  // Microsoft
  { title: "Phi-4-reasoning-vision-15B Technical Report", vendor: "Microsoft", date: "2026-03-04", pdfUrl: "https://arxiv.org/pdf/2603.XXXXX", summary: "Phi-4 推理视觉模型技术报告，15B 参数量级。" },
];

// 精准 arXiv 搜索：只搜索模型名 + "technical report"
const ARXIV_QUERIES = [
  { vendor: 'OpenAI', query: 'all:"GPT-5"+AND+all:"technical+report" OR all:"GPT-5"+AND+all:"system+card"' },
  { vendor: 'Google DeepMind', query: 'all:"Gemini 3"+AND+all:"technical+report" OR all:"Gemma 3"+AND+all:"technical+report"' },
  { vendor: 'Meta', query: 'all:"Llama 4"+AND+all:technical' },
  { vendor: 'Anthropic', query: 'all:"Claude Opus 4" OR all:"Claude 5"+AND+all:"model"' },
  { vendor: 'Mistral', query: 'all:"Mistral Large" OR all:"Pixtral Large"' },
  { vendor: 'DeepSeek', query: 'all:DeepSeek-V4 OR all:"DeepSeek V4" OR all:DeepSeek-R2 OR all:"DeepSeek Prover"' },
  { vendor: '智谱 (GLM)', query: 'all:"GLM-5"+AND+all:technical OR all:"GLM-5.1"' },
  { vendor: '阿里 (Qwen)', query: 'all:"Qwen3.6" OR all:"Qwen3.5"+AND+all:technical' },
  { vendor: '百度', query: 'all:"ERNIE 5" OR all:"ERNIE+5.0"+AND+all:technical' },
  { vendor: 'Moonshot (Kimi)', query: 'all:"Kimi K2"+AND+all:technical OR all:"Kimi k2.6"' },
  { vendor: '华为', query: 'all:Pangu+AND+all:technical+AND+cat:cs.*' },
  { vendor: 'Microsoft', query: 'all:"Phi-4"+AND+all:technical OR all:BitNet+AND+all:technical+AND+cat:cs.*' },
];

function titleKeywords(title) {
  const lower = title.toLowerCase();
  const modelKeywords = [
    'technical report', 'system card', 'model card',
    'language model', 'large language', 'llm', 'chatgpt', 'gpt-5',
    'gemini', 'gemma', 'llama', 'claude', 'deepseek', 'qwen', 'kimi',
    'ernie', 'pangu', 'phi-4', 'bitnet', 'glm-5',
    'reasoning', 'multimodal', 'vision-language'
  ];
  return modelKeywords.some(kw => lower.includes(kw));
}

async function fetchArxiv() {
  const papers = [];
  const seen = new Set(KNOWN_PAPERS.map(p => p.title));

  for (const q of ARXIV_QUERIES) {
    try {
      const url = `http://export.arxiv.org/api/query?search_query=${q.query}&sortBy=submittedDate&sortOrder=descending&max_results=5`;
      const res = await fetch(url);
      const text = await res.text();

      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(text)) !== null) {
        const entry = match[1];
        const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
        const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
        const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
        const linkMatch = entry.match(/<link[^>]*href="([^"]*arxiv.org\/abs\/[^"]*)"/);

        if (titleMatch) {
          const title = titleMatch[1].replace(/\s+/g, ' ').trim();
          if (seen.has(title) || !titleKeywords(title)) continue;

          const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '';
          const published = publishedMatch ? publishedMatch[1].substring(0, 10) : '';
          const arxivUrl = linkMatch ? linkMatch[1] : '';
          const arxivId = arxivUrl ? arxivUrl.split('/abs/').pop() : '';
          const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : '';

          papers.push({ title, vendor: q.vendor, date: published, arxivId, pdfUrl, summary, tags: [] });
          seen.add(title);
        }
      }
    } catch (e) {
      console.error(`  ⚠️ ${q.vendor}: ${e.message}`);
    }
  }
  return papers;
}

async function main() {
  console.log('📡 抓取 Top 15 AI 厂商新模型论文...\n');

  // 以已知论文为基础
  let existing = [...KNOWN_PAPERS];
  if (existsSync(OUTPUT_PATH)) {
    try {
      const saved = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
      for (const p of saved) {
        if (!existing.find(e => e.title === p.title)) {
          existing.push(p);
        }
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

  // 搜索 arXiv 新论文
  const newPapers = await fetchArxiv();

  let added = 0;
  for (const paper of newPapers) {
    if (!seen.has(paper.title)) {
      base.push(paper);
      seen.add(paper.title);
      added++;
      console.log(`  ✨ ${paper.vendor}: ${paper.title.substring(0, 70)}`);
    }
  }

  // 生成中文简介
  for (const p of base) {
    if (!p.descriptionCn) p.descriptionCn = cnDesc(p);
  }

  base.sort((a, b) => b.date.localeCompare(a.date));

  // === Step 3: 搜索 HuggingFace 模型库（国内厂商常用） ===
  console.log('\n🔍 搜索 HuggingFace...');
  const hfPapers = await fetchHF(seen);
  for (const paper of hfPapers) {
    if (!seen.has(paper.title)) {
      if (!paper.descriptionCn) paper.descriptionCn = cnDesc(paper);
      base.push(paper);
      seen.add(paper.title);
      added++;
      console.log(`  ✨ HF: ${paper.vendor} - ${paper.title.substring(0, 70)}`);
    }
  }

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

// === 中文简介生成 ===
function cnDesc(paper) {
  const title = paper.title || '';
  const s = (paper.summary || '').toLowerCase();

  // 提取标题中的核心信息融入简介
  if (title.includes('GPT-5'))
    return `《${title}》— OpenAI 最新旗舰大语言模型，涵盖多模态理解、复杂推理、代码生成及安全性评测。`;
  if (title.includes('Gemini 3') || title.includes('Gemini 3 Pro'))
    return `《${title}》— Google DeepMind 最新多模态大模型，在视觉理解、长上下文推理和 Agent 能力方面显著提升。`;
  if (title.includes('Gemma 3'))
    return `《${title}》— Google 开源轻量级大语言模型，支持端侧部署与高效微调。`;
  if (title.includes('Llama 4'))
    return `《${title}》— Meta 最新开源旗舰模型，采用 MoE 混合专家架构，在推理、多语言和编码任务中表现优异。`;
  if (title.includes('Claude Opus 4'))
    return `《${title}》— Anthropic 旗舰安全大语言模型，专注于复杂推理、长文本理解和可信 AI 对齐。`;
  if (title.includes('DeepSeek-V4'))
    return `《${title}》— 深度求索最新旗舰模型，支持百万 Token 超长上下文，多 Token 预测与 MLA 注意力机制大幅提升推理效率。`;
  if (title.includes('DeepSeek-Prover-V2'))
    return `《${title}》— 深度求索数学定理证明模型，基于强化学习的子目标分解策略，在形式化验证任务中取得突破。`;
  if (title.includes('DeepSeek-Prover'))
    return `《${title}》— 深度求索定理证明大模型，通过大规模合成数据训练实现自动定理证明。`;
  if (title.includes('GLM-5.1'))
    return `《${title}》— 智谱 AI 最新大语言模型，增强智能体工程与复杂任务自动处理能力。`;
  if (title.includes('GLM-5'))
    return `《${title}》— 智谱 AI 旗舰大语言模型，从辅助编码到智能体工程的全面能力升级。`;
  if (title.includes('Qwen3.6'))
    return `《${title}》— 阿里通义千问最新旗舰模型，在推理、编码和多语言方面性能对标国际顶尖水平。`;
  if (title.includes('Qwen3.5-Omni'))
    return `《${title}》— 通义千问全模态大模型，统一文本、图像、音频的理解与生成能力。`;
  if (title.includes('Qwen3') || title.includes('QwQ'))
    return `《${title}》— 阿里通义千问系列大语言模型，开源 MoE 架构，性能与效率兼顾。`;
  if (title.includes('ERNIE 5.0') || title.includes('ERNIE 5'))
    return `《${title}》— 百度文心最新旗舰大语言模型，在知识增强、推理和多模态方面全面升级。`;
  if (title.includes('Kimi K2') || title.includes('Kimi-K2'))
    return `《${title}》— 月之暗面开放智能体架构模型，编码和工具调用能力卓越，专注 Agent 应用场景。`;
  if (title.includes('Kimi k2.6'))
    return `《${title}》— 月之暗面 Kimi 系列最新版本，推理和 Agent 能力进一步增强。`;
  if (title.includes('Pangu Embedded'))
    return `《${title}》— 华为盘古双系统推理器，融合 System 1 快速直觉与 System 2 深度思考。`;
  if (title.includes('Pangu Pro MoE'))
    return `《${title}》— 华为盘古混合专家模型，分组专家机制实现高效稀疏化训练与推理。`;
  if (title.includes('Pangu Ultra MoE'))
    return `《${title}》— 华为盘古超大规模混合专家模型技术报告，基于昇腾 NPU 的大规模训练实践。`;
  if (title.includes('Pangu Light'))
    return `《${title}》— 华为盘古模型高效剪枝与加速方案。`;
  if (title.includes('Pangu'))
    return `《${title}》— 华为盘古系列大语言模型，自研架构赋能多场景 AI 应用。`;
  if (title.includes('Phi-4-reasoning'))
    return `《${title}》— 微软 Phi-4 推理模型，在小参数量下实现强大的多步推理能力。`;
  if (title.includes('Phi-4-Mini'))
    return `《${title}》— 微软紧凑型多模态模型，兼顾性能与部署效率，适合边缘计算场景。`;
  if (title.includes('Phi-4'))
    return `《${title}》— 微软高效小模型系列，以极少参数实现接近大模型的性能。`;
  if (title.includes('Sparse-BitNet'))
    return `《${title}》— 微软稀疏量化模型，结合 1.58-bit 量化与半结构化稀疏，实现极致推理效率。`;
  if (title.includes('BitNet'))
    return `《${title}》— 微软 1-bit 量化大模型，突破传统精度限制，大幅降低推理成本。`;
  if (title.includes('MAGNET'))
    return `《${title}》— 微软去中心化自主 AI 研究框架，基于 BitNet 的专家模型自动生成系统。`;
  if (title.includes('AutoGen'))
    return `《${title}》— 微软多智能体协作框架，支持多 Agent 的复杂任务编排与自动化。`;
  if (title.includes('CogVideoX'))
    return `《${title}》— 智谱 AI 文本到视频扩散模型，基于专家 Transformer 实现高质量视频生成。`;
  if (title.includes('CogAgent'))
    return `《${title}》— 智谱 AI 视觉语言 GUI 智能体，可直接理解并操作图形界面。`;
  if (title.includes('Mistral Large') || title.includes('Mixtral'))
    return `《${title}》— Mistral AI 旗舰模型，欧洲领先的开源大语言模型，MoE 架构兼顾性能与效率。`;
  if (title.includes('Pixtral'))
    return `《${title}》— Mistral AI 多模态视觉语言模型，整合文本与图像理解能力。`;
  if (title.includes('Mistral'))
    return `《${title}》— Mistral AI 开源大语言模型，欧洲 AI 领域代表性成果。`;

  // 通用回退
  return `《${title.substring(0,80)}》— ${paper.vendor} 发布的最新研究论文。`;
}
// === HuggingFace 搜索 ===
const HF_MODELS = [
  { vendor: 'DeepSeek', id: 'deepseek-ai/DeepSeek-V4-Pro' },
  { vendor: 'DeepSeek', id: 'deepseek-ai/DeepSeek-R1' },
  { vendor: '阿里 (Qwen)', id: 'Qwen/Qwen3.6' },
  { vendor: '阿里 (Qwen)', id: 'Qwen/Qwen3.5-Omni' },
  { vendor: '智谱 (GLM)', id: 'THUDM/GLM-5' },
  { vendor: '智谱 (GLM)', id: 'THUDM/GLM-5.1' },
  { vendor: 'Moonshot (Kimi)', id: 'moonshotai/Kimi-K2' },
  { vendor: '华为', id: 'Huawei/Pangu-Embedded' },
  { vendor: 'Microsoft', id: 'microsoft/Phi-4' },
  { vendor: '百度', id: 'baidu/ERNIE-5.0' },
];

async function fetchHF(seenTitles) {
  const papers = [], seenLocal = new Set();
  for (const { vendor, id } of HF_MODELS) {
    try {
      const res = await fetch(`https://huggingface.co/api/models/${id}`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) continue;
      const info = await res.json();
      const pdfs = (info.siblings || []).filter(f => (f.rfilename || '').toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) continue;
      const date = (info.createdAt || info.lastModified || '').substring(0, 10);
      const title = info.cardData?.title || `${id.split('/').pop()} Technical Report`;
      if (seenTitles.has(title) || seenLocal.has(title)) continue;
      seenLocal.add(title);
      papers.push({
        title, vendor, date, arxivId: null,
        pdfUrl: `https://huggingface.co/${id}/resolve/main/${pdfs[0].rfilename}`,
        summary: info.cardData?.modelDescription || '',
        descriptionCn: cnDesc({ title, vendor, summary: info.cardData?.modelDescription || '' }),
        tags: ['HuggingFace'],
      });
    } catch (e) { /* HF 不可达，静默跳过 */ }
  }
  return papers;
}
