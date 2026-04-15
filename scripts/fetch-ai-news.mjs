#!/usr/bin/env node
/**
 * fetch-ai-news.mjs — 自动抓取 arXiv + Hacker News AI 资讯
 * 输出到 src/data/ai-news.json
 * 
 * 用法: node scripts/fetch-ai-news.mjs [--limit N]
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = `${__dirname}/../src/data/ai-news.json`;
const MAX_ITEMS = parseInt(process.argv.find(a => a === '--limit') ? 0 : 15, 10) || 15;

const ARXIV_API = 'http://export.arxiv.org/api/query?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=20';
const HN_API = 'https://hacker-news.firebaseio.com/v0/topstories.json';

async function fetchArxiv() {
  try {
    const res = await fetch(ARXIV_API);
    const text = await res.text();
    
    // Simple XML parsing for arXiv entries
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    
    while ((match = entryRegex.exec(text)) !== null && entries.length < 10) {
      const entry = match[1];
      const titleMatch = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/);
      const summaryMatch = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/);
      const publishedMatch = entry.match(/<published>(.*?)<\/published>/);
      const linkMatch = entry.match(/<link[^>]*href="([^"]*arxiv.org\/abs\/[^"]*)"/);
      const tagMatch = entry.match(/<term[^>]*>([\s\S]*?)<\/term>/g);
      
      if (titleMatch) {
        const title = titleMatch[1].replace(/\s+/g, ' ').trim();
        const summary = summaryMatch ? summaryMatch[1].replace(/\s+/g, ' ').trim().substring(0, 200) : '';
        const published = publishedMatch ? publishedMatch[1].substring(0, 10) : '';
        const url = linkMatch ? linkMatch[1] : '';
        const tags = tagMatch ? tagMatch.map(t => t.replace(/<\/?term>/g, '').split('.').pop()).slice(0, 2) : [];
        
        entries.push({
          date: published,
          title: title,
          summary: summary,
          url: url,
          tags: tags,
          source: 'arXiv'
        });
      }
    }
    return entries;
  } catch (e) {
    console.error('arXiv fetch error:', e.message);
    return [];
  }
}

async function fetchHackerNews() {
  try {
    const idsRes = await fetch(HN_API);
    const ids = await idsRes.json();
    const topIds = ids.slice(0, 30);
    
    const items = await Promise.all(
      topIds.map(async (id) => {
        try {
          const res = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          const item = await res.json();
          if (item && item.title && item.score > 50) {
            const title = item.title;
            const aiKeywords = ['ai', 'llm', 'gpt', 'model', 'agent', 'machine learning', 'deep learning', 'neural', 'transformer', 'claude', 'openai', 'anthropic'];
            const isAI = aiKeywords.some(kw => title.toLowerCase().includes(kw));
            if (isAI) {
              const date = new Date(item.time * 1000).toISOString().substring(0, 10);
              return {
                date,
                title: title,
                summary: item.url ? `via ${new URL(item.url).hostname}` : (item.text ? item.text.substring(0, 150).replace(/<[^>]+>/g, '') : ''),
                url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
                tags: ['Hacker News'],
                source: 'HN',
                score: item.score
              };
            }
          }
        } catch {}
        return null;
      })
    );
    
    return items.filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 5);
  } catch (e) {
    console.error('HN fetch error:', e.message);
    return [];
  }
}

async function main() {
  console.log('🔄 Fetching AI news...');
  
  const [arxivItems, hnItems] = await Promise.all([
    fetchArxiv(),
    fetchHackerNews()
  ]);
  
  console.log(`  arXiv: ${arxivItems.length} items`);
  console.log(`  Hacker News: ${hnItems.length} items`);
  
  // Merge and deduplicate by title similarity
  const allItems = [...arxivItems, ...hnItems];
  const seen = new Set();
  const unique = allItems.filter(item => {
    const key = item.title.toLowerCase().substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  // Sort by date descending
  unique.sort((a, b) => b.date.localeCompare(a.date));
  
  // Limit
  const result = unique.slice(0, MAX_ITEMS);
  
  // Read existing to preserve history
  let existing = [];
  if (existsSync(OUTPUT_PATH)) {
    try {
      existing = JSON.parse(readFileSync(OUTPUT_PATH, 'utf-8')).items || [];
    } catch {}
  }
  
  // Merge: new items + existing (deduplicated)
  const mergedKeys = new Set(result.map(i => i.title.toLowerCase().substring(0, 50)));
  const preserved = existing.filter(i => !mergedKeys.has(i.title.toLowerCase().substring(0, 50)));
  const final = [...result, ...preserved].slice(0, 50); // keep last 50
  
  const output = {
    updatedAt: new Date().toISOString(),
    items: final
  };
  
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf-8');
  
  console.log(`✅ Saved ${final.length} news items to ${OUTPUT_PATH}`);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
