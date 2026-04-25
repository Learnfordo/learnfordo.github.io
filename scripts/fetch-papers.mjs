#!/usr/bin/env node
/**
 * fetch-papers.mjs — 抓取 Top 15 AI 厂商的新模型论文（技术报告）
 * 输出到 src/data/papers.json
 *
 * 策略：搜索已知模型名称的技术报告，而不是搜厂商所有论文
 * 用法: node scripts/fetch-papers.mjs
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = `${__dirname}/../src/data/papers.json`;

// 搜索策略：精确匹配已知模型名称 + "technical report" 或模型名本身
const SEARCH_QUERIES = [
  // OpenAI
  { vendor: 'OpenAI', search: 'ti:GPT-5+OR+ti:"o4"+OR+ti:o3-mini+OR+ti:GPT-4.1+OR+ti:Operator+OR+ti:"DALL-E 4"' },
  // Google DeepMind
  { vendor: 'Google DeepMind', search: 'ti:Gemini+3+OR+ti:"Gemini 2.5"+OR+ti:Gemma+3+OR+ti:AlphaFold+4+OR+ti:"Gemma 3"' },
  // Meta
  { vendor: 'Meta', search: 'ti:"Llama 4"+OR+ti:"LLaMA 4"+OR+ti:Llama-4' },
  // Anthropic
  { vendor: 'Anthropic', search: 'ti:"Claude 5"+OR+ti:"Claude Opus 4"+OR+ti:"Claude Sonnet 4"' },
  // Mistral
  { vendor: 'Mistral', search: 'ti:Mistral+Large+OR+ti:Mixtral+OR+ti:Codestral+OR+ti:"Mistral Small"' },
  // DeepSeek
  { vendor: 'DeepSeek', search: 'ti:"DeepSeek-V4"+OR+ti:"DeepSeek-R2"+OR+ti:"DeepSeek-Prover"' },
  // 智谱
  { vendor: '智谱 (GLM)', search: 'ti:"GLM-5"+OR+ti:"GLM-4.7"+OR+ti:CogAgent+OR+ti:CogVideoX' },
  // 阿里 Qwen
  { vendor: '阿里 (Qwen)', search: 'ti:"Qwen3"+OR+ti:"Qwen3.6"+OR+ti:QwQ+OR+ti:"Qwen2.5-Omni"' },
  // 百度
  { vendor: '百度', search: 'ti:ERNIE+OR+ti:"ERNIE 4.5"+OR+ti:"ERNIE 5"' },
  // 字节
  { vendor: '字节跳动', search: 'ti:Doubao+OR+ti:"Seed 1.6"+OR+ti:"Seed 2"' },
  // Moonshot Kimi
  { vendor: 'Moonshot (Kimi)', search: 'ti:"Kimi-K2"+OR+ti:"Kimi-k2.6"+OR+ti:"Moonshot"' },
  // MiniMax
  { vendor: 'MiniMax', search: 'ti:"MiniMax-01"+OR+ti:"MiniMax-Text"+OR+ti:abab+7+OR+ti:"Hailuo"' },
  // 科大讯飞
  { vendor: '科大讯飞', search: 'ti:"Spark 4"+OR+ti:"讯飞星火"' },
  // 华为
  { vendor: '华为', search: 'ti:"Pangu"+OR+ti:"Pangu-5"' },
  // Microsoft
  { vendor: 'Microsoft', search: 'ti:"Phi-4"+OR+ti:"BitNet"+OR+ti:"AutoGen"' },
];

async function fetchArxivPapers() {
  const papers = [];

  for (const query of SEARCH_QUERIES) {
    try {
      const url = `http://export.arxiv.org/api/query?search_query=${query.search}&sortBy=submittedDate&sortOrder=descending&max_results=5`;
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
          const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim().substring(0, 300) : '';
          const published = publishedMatch ? publishedMatch[1].substring(0, 10) : '';
          const arxivUrl = linkMatch ? linkMatch[1] : '';
          const arxivId = arxivUrl ? arxivUrl.split('/abs/').pop() : '';
          const pdfUrl = arxivId ? `https://arxiv.org/pdf/${arxivId}` : '';

          papers.push({
            title,
            vendor: query.vendor,
            date: published,
            arxivId,
            pdfUrl,
            summary,
            tags: []
          });
        }
      }
    } catch (e) {
      console.error(`Error fetching ${query.vendor}:`, e.message);
    }
  }

  // 去重
  const seen = new Set();
  const unique = papers.filter(p => {
    const key = p.arxivId || p.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 按日期降序
  unique.sort((a, b) => b.date.localeCompare(a.date));

  return unique;
}

async function main() {
  console.log('📡 抓取 Top 15 AI 厂商新模型论文（技术报告）...');

  let existing = [];
  if (existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8'));
    } catch (e) {
      existing = [];
    }
  }

  const newPapers = await fetchArxivPapers();

  // 合并：已有论文保留，新论文加入
  const existingIds = new Set(existing.map(p => p.arxivId || p.title));
  const merged = [...existing];

  let added = 0;
  for (const paper of newPapers) {
    const key = paper.arxivId || paper.title;
    if (!existingIds.has(key)) {
      merged.push(paper);
      existingIds.add(key);
      added++;
      console.log(`  ✨ 新论文: ${paper.vendor} - ${paper.title}`);
    }
  }

  merged.sort((a, b) => b.date.localeCompare(a.date));

  // 只保留最近 180 天（半年）
  const halfYearAgo = new Date();
  halfYearAgo.setDate(halfYearAgo.getDate() - 180);
  const recent = merged.filter(p => new Date(p.date) >= halfYearAgo);

  writeFileSync(OUTPUT_PATH, JSON.stringify(recent, null, 2));
  console.log(`\n✅ 已写入 ${recent.length} 篇论文到 papers.json`);
  console.log(`   本次新增: ${added} 篇`);
}

main().catch(e => {
  console.error('❌ 报错:', e.message);
  process.exit(1);
});