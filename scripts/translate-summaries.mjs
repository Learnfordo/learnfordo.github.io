#!/usr/bin/env node
/**
 * translate-summaries.mjs — 为论文生成中文简介
 */
import { readFileSync, writeFileSync } from 'fs';

const VENDOR_DESC = {
  'OpenAI': 'OpenAI 发布的新一代大语言模型。',
  'Google DeepMind': 'Google DeepMind 发布的最新 AI 模型。',
  'Meta': 'Meta AI 开源大语言模型。',
  'Anthropic': 'Anthropic 发布的安全对齐大语言模型。',
  'Mistral': 'Mistral AI 发布的开源大语言模型。',
  'DeepSeek': 'DeepSeek 深度求索发布的最新 AI 模型。',
  '智谱 (GLM)': '智谱 AI 发布的 GLM 系列大语言模型。',
  '阿里 (Qwen)': '阿里云通义千问 Qwen 系列大语言模型。',
  '百度': '百度文心 ERNIE 系列大语言模型。',
  '字节跳动': '字节跳动发布的最新 AI 模型。',
  'Moonshot (Kimi)': '月之暗面 Moonshot AI 发布的 Kimi 系列模型。',
  'MiniMax': 'MiniMax 发布的最新 AI 大模型。',
  '科大讯飞': '科大讯飞星火 Spark 系列大语言模型。',
  '华为': '华为盘古 Pangu 系列大语言模型。',
  'Microsoft': '微软 Phi / BitNet 系列模型。',
};

const TITLE_DESC = [
  { match: /GPT-5/, desc: 'GPT-5 旗舰大语言模型技术报告，涵盖多模态能力、推理性能和安全性评测。' },
  { match: /Gemini.?3/, desc: 'Gemini 3 多模态大模型技术报告，在视觉理解、推理和代码生成方面有显著提升。' },
  { match: /Gemma.?3/, desc: 'Gemma 3 轻量级开源大语言模型技术报告，适合端侧部署和高效推理。' },
  { match: /Llama.?4/, desc: 'Llama 4 开源大语言模型技术报告，采用 MoE 架构，性能和效率大幅提升。' },
  { match: /Claude.*Opus.?4/, desc: 'Claude Opus 4 旗舰模型技术报告，在安全对齐和复杂推理方面达到新高度。' },
  { match: /Claude.*5/, desc: 'Claude 5 新一代安全大语言模型技术报告。' },
  { match: /DeepSeek.*V4/, desc: 'DeepSeek V4 技术报告，引入多 Token 预测机制和高效推理架构。' },
  { match: /DeepSeek.*Prover/, desc: 'DeepSeek Prover 数学定理证明模型技术报告，在形式化验证方面取得突破。' },
  { match: /DeepSeek.*R2/, desc: 'DeepSeek R2 推理增强模型技术报告。' },
  { match: /GLM-5/, desc: 'GLM-5 大语言模型技术报告，支持智能体工程和复杂任务自动化。' },
  { match: /Qwen3\.6/, desc: 'Qwen3.6-Max 旗舰模型技术报告，在推理、编码和多语言方面性能对标国际一流。' },
  { match: /Qwen3\.5.*Omni/, desc: 'Qwen3.5-Omni 全模态大模型技术报告，统一文本、图像、音频理解和生成。' },
  { match: /Qwen3/, desc: 'Qwen3 大语言模型技术报告，开源 MoE 架构，性能优异。' },
  { match: /ERNIE.?5/, desc: '文心 ERNIE 5.0 大语言模型技术报告，百度最新旗舰 AI 模型。' },
  { match: /Kimi.?K2/, desc: 'Kimi K2 开放智能体架构模型技术报告，编码和工具调用能力卓越。' },
  { match: /Kimi.*k2\.6/, desc: 'Kimi K2.6 最新版本模型技术报告，推理和 Agent 能力进一步增强。' },
  { match: /Pangu.*Embedded/, desc: '盘古 Embedded 双系统推理器技术报告，融合快速推理与深度思考。' },
  { match: /Pangu.*Pro.*MoE/, desc: '盘古 Pro MoE 混合专家模型技术报告，高效稀疏化训练。' },
  { match: /Pangu.*Ultra.*MoE/, desc: '盘古 Ultra MoE 大规模混合专家模型技术报告，在昇腾 NPU 上训练。' },
  { match: /Pangu.*Light/, desc: '盘古 Light 高效剪枝与加速推理技术报告。' },
  { match: /Pangu/, desc: '盘古系列大语言模型技术报告，华为自研 AI 大模型。' },
  { match: /Phi-4.*reasoning/, desc: 'Phi-4 Reasoning 推理模型技术报告，小参数实现强推理能力。' },
  { match: /Phi-4.*Mini/, desc: 'Phi-4 Mini 紧凑多模态模型技术报告，适合移动端和边缘部署。' },
  { match: /Phi-4/, desc: 'Phi-4 高效小模型技术报告，微软小模型系列最新进展。' },
  { match: /BitNet/, desc: 'BitNet 1.58 比特量化模型技术报告，极致压缩高效推理。' },
  { match: /Sparse-BitNet/, desc: 'Sparse-BitNet 稀疏量化模型技术报告，结合结构化稀疏与极致量化。' },
  { match: /MAGNET/, desc: 'MAGNET 自主专家模型生成框架技术报告，去中心化自动研究。' },
  { match: /AutoGen/, desc: 'AutoGen 多智能体框架技术报告，微软多 Agent 协作平台。' },
  { match: /CogVideoX/, desc: 'CogVideoX 文本到视频扩散模型技术报告，智谱多模态生成最新进展。' },
  { match: /CogAgent/, desc: 'CogAgent 视觉语言 GUI 智能体模型技术报告。' },
  { match: /Mistral/, desc: 'Mistral 开源大语言模型技术报告，欧洲领先 AI 模型。' },
  { match: /Mixtral/, desc: 'Mixtral MoE 混合专家模型技术报告，高效开源大模型。' },
  { match: /Pixtral/, desc: 'Pixtral 多模态视觉语言模型技术报告。' },
];

function getDesc(paper) {
  // 先精确匹配标题
  for (const rule of TITLE_DESC) {
    if (rule.match.test(paper.title)) return rule.desc;
  }
  
  // 回退：用厂商简介 + 摘要
  const vendorDesc = VENDOR_DESC[paper.vendor] || `${paper.vendor} 发布的最新 AI 模型。`;
  
  // 根据摘要内容补充
  let extra = '';
  const summary = paper.summary?.toLowerCase() || '';
  if (summary.includes('code') || summary.includes('programming')) extra = '侧重编码和程序生成能力。';
  else if (summary.includes('reasoning') || summary.includes('math')) extra = '强调数学推理和逻辑能力。';
  else if (summary.includes('vision') || summary.includes('image')) extra = '具备视觉理解或多模态能力。';
  else if (summary.includes('safety') || summary.includes('alignment')) extra = '关注安全对齐和可控性。';
  else if (summary.includes('agent') || summary.includes('tool')) extra = '专注于 Agent 和工具调用能力。';
  else if (summary.includes('efficien') || summary.includes('sparse')) extra = '聚焦模型效率和推理优化。';
  
  return vendorDesc + (extra ? ' ' + extra : '');
}

const papers = JSON.parse(readFileSync('/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/data/papers.json', 'utf-8'));
let updated = 0;
for (const p of papers) {
  if (!p.descriptionCn) {
    p.descriptionCn = getDesc(p);
    updated++;
  }
}
writeFileSync('/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/data/papers.json', JSON.stringify(papers, null, 2));
console.log(`✅ 更新了 ${updated} 篇论文的中文简介`);