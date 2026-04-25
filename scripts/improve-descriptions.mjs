#!/usr/bin/env node
/**
 * improve-descriptions.mjs — 为所有论文生成更好的中文简介
 * 将英文标题翻译融入简介
 */
import { readFileSync, writeFileSync } from 'fs';

// 厂商图标色
const ICONS = {
  'OpenAI': { initial: 'O', color: '#10a37f' },
  'Google DeepMind': { initial: 'G', color: '#4285f4' },
  'Meta': { initial: 'M', color: '#0668e1' },
  'Anthropic': { initial: 'A', color: '#d97757' },
  'Mistral': { initial: 'M', color: '#f97316' },
  'DeepSeek': { initial: 'D', color: '#4f46e5' },
  '智谱 (GLM)': { initial: 'Z', color: '#3b82f6' },
  '阿里 (Qwen)': { initial: 'A', color: '#ff6a00' },
  '百度': { initial: 'B', color: '#de2910' },
  '字节跳动': { initial: 'B', color: '#3c8cff' },
  'Moonshot (Kimi)': { initial: 'K', color: '#6366f1' },
  'MiniMax': { initial: 'M', color: '#8b5cf6' },
  '科大讯飞': { initial: 'K', color: '#2563eb' },
  '华为': { initial: 'H', color: '#cf0a2c' },
  'Microsoft': { initial: 'M', color: '#0078d4' },
};

// 标题中关键词中英对照
const TRANSLATIONS = {
  'Technical Report': '技术报告',
  'System Card': '系统卡',
  'Model Card': '模型卡',
  'Architecture': '架构',
  'Training': '训练',
  'Evaluation': '评估',
  'Deployment': '部署',
  'Reasoning': '推理',
  'Multimodal': '多模态',
  'Vision': '视觉',
  'Language Model': '语言模型',
  'Large Language Model': '大语言模型',
  'Mixture of Experts': '混合专家',
  'Efficient': '高效',
  'Open Source': '开源',
  'Agent': '智能体',
  'Coding': '编码',
  'Programming': '编程',
  'Safety': '安全',
  'Alignment': '对齐',
  'Mathematical': '数学',
  'Theorem': '定理',
  'Inference': '推理',
};

function translateTitle(title) {
  let cn = title;
  for (const [en, zh] of Object.entries(TRANSLATIONS)) {
    cn = cn.replace(new RegExp(en, 'gi'), zh);
  }
  // 移除多余空格
  cn = cn.replace(/\s+/g, ' ').trim();
  return cn;
}

function improveDesc(paper) {
  const titleCn = translateTitle(paper.title);
  
  // 尝试提取论文标题中的核心信息
  if (paper.title.includes('GPT-5')) {
    return `《GPT-5 ${titleCn.replace(/GPT-5\s*/i, '')}》— OpenAI 最新旗舰大语言模型，涵盖多模态理解、复杂推理、代码生成及安全性评测。`;
  }
  if (paper.title.includes('Gemini 3') || paper.title.includes('Gemini 3 Pro')) {
    return `《${titleCn}》— Google DeepMind 最新多模态大模型，在视觉理解、长上下文推理和 Agent 能力方面显著提升。`;
  }
  if (paper.title.includes('Gemma 3')) {
    return `《${titleCn}》— Google 开源轻量级大语言模型，支持端侧部署与高效微调。`;
  }
  if (paper.title.includes('Llama 4')) {
    return `《${titleCn}》— Meta 最新开源旗舰模型，采用 MoE 混合专家架构，在推理、多语言和编码任务中表现优异。`;
  }
  if (paper.title.includes('Claude Opus 4')) {
    return `《${titleCn}》— Anthropic 旗舰安全大语言模型，专注于复杂推理、长文本理解和可信 AI 对齐。`;
  }
  if (paper.title.includes('Claude 5')) {
    return `《${titleCn}》— Anthropic 新一代安全对齐大语言模型。`;
  }
  if (paper.title.includes('DeepSeek-V4')) {
    return `《${titleCn}》— 深度求索最新旗舰模型，支持百万 Token 超长上下文，多 Token 预测与 MLA 注意力机制大幅提升推理效率。`;
  }
  if (paper.title.includes('DeepSeek-Prover-V2')) {
    return `《${titleCn}》— 深度求索数学定理证明模型，基于强化学习的子目标分解策略，在形式化验证任务中取得突破。`;
  }
  if (paper.title.includes('DeepSeek-Prover')) {
    return `《${titleCn}》— 深度求索定理证明大模型，通过大规模合成数据训练实现自动定理证明。`;
  }
  if (paper.title.includes('DeepSeek-R2')) {
    return `《${titleCn}》— 深度求索推理增强模型，强化长链推理和多步逻辑能力。`;
  }
  if (paper.title.includes('GLM-5.1')) {
    return `《${titleCn}》— 智谱 AI 最新大语言模型，增强智能体工程与复杂任务自动处理能力。`;
  }
  if (paper.title.includes('GLM-5')) {
    return `《${titleCn}》— 智谱 AI 旗舰大语言模型，从辅助编码到智能体工程的全面能力升级。`;
  }
  if (paper.title.includes('Qwen3.6')) {
    return `《${titleCn}》— 阿里通义千问最新旗舰模型，在推理、编码和多语言方面性能对标国际顶尖水平。`;
  }
  if (paper.title.includes('Qwen3.5-Omni')) {
    return `《${titleCn}》— 通义千问全模态大模型，统一文本、图像、音频的理解与生成能力。`;
  }
  if (paper.title.includes('Qwen3') || paper.title.includes('QwQ')) {
    return `《${titleCn}》— 阿里通义千问系列大语言模型，开源 MoE 架构，性能与效率兼顾。`;
  }
  if (paper.title.includes('ERNIE 5.0') || paper.title.includes('ERNIE 5')) {
    return `《${titleCn}》— 百度文心最新旗舰大语言模型，在知识增强、推理和多模态方面全面升级。`;
  }
  if (paper.title.includes('Kimi-K2') || paper.title.includes('Kimi K2')) {
    return `《${titleCn}》— 月之暗面开放智能体架构模型，编码和工具调用能力卓越，专注 Agent 应用场景。`;
  }
  if (paper.title.includes('Kimi k2.6')) {
    return `《${titleCn}》— 月之暗面 Kimi 系列最新版本，推理和 Agent 能力进一步增强。`;
  }
  if (paper.title.includes('Pangu Embedded')) {
    return `《${titleCn}》— 华为盘古双系统推理器，融合 System 1 快速直觉与 System 2 深度思考，实现高效元认知。`;
  }
  if (paper.title.includes('Pangu Pro MoE')) {
    return `《${titleCn}》— 华为盘古混合专家模型，分组专家机制实现高效稀疏化训练与推理。`;
  }
  if (paper.title.includes('Pangu Ultra MoE')) {
    return `《${titleCn}》— 华为盘古超大规模混合专家模型技术报告，基于昇腾 NPU 的大规模训练实践。`;
  }
  if (paper.title.includes('Pangu Light')) {
    return `《${titleCn}》— 华为盘古模型高效剪枝与加速方案，权重重初始化降低剪枝后性能损失。`;
  }
  if (paper.title.includes('Pangu')) {
    return `《${titleCn}》— 华为盘古系列大语言模型，自研架构赋能多场景 AI 应用。`;
  }
  if (paper.title.includes('Phi-4-reasoning')) {
    return `《${titleCn}》— 微软 Phi-4 推理模型，在小参数量下实现强大的多步推理能力。`;
  }
  if (paper.title.includes('Phi-4-Mini')) {
    return `《${titleCn}》— 微软紧凑型多模态模型，兼顾性能与部署效率，适合边缘计算场景。`;
  }
  if (paper.title.includes('Phi-4')) {
    return `《${titleCn}》— 微软高效小模型系列，以极少参数实现接近大模型的性能。`;
  }
  if (paper.title.includes('Sparse-BitNet')) {
    return `《${titleCn}》— 微软稀疏量化模型，结合 1.58-bit 量化与半结构化稀疏，实现极致推理效率。`;
  }
  if (paper.title.includes('BitNet')) {
    return `《${titleCn}》— 微软 1-bit 量化大模型，突破传统精度限制，大幅降低推理成本。`;
  }
  if (paper.title.includes('MAGNET')) {
    return `《${titleCn}》— 微软去中心化自主 AI 研究框架，基于 BitNet 的专家模型自动生成系统。`;
  }
  if (paper.title.includes('AutoGen')) {
    return `《${titleCn}》— 微软多智能体协作框架，支持多 Agent 的复杂任务编排与自动化。`;
  }
  if (paper.title.includes('CogVideoX')) {
    return `《${titleCn}》— 智谱 AI 文本到视频扩散模型，基于专家 Transformer 实现高质量视频生成。`;
  }
  if (paper.title.includes('CogAgent')) {
    return `《${titleCn}》— 智谱 AI 视觉语言 GUI 智能体，可直接理解并操作图形界面。`;
  }
  if (paper.title.includes('Mistral Large') || paper.title.includes('Mixtral')) {
    return `《${titleCn}》— Mistral AI 旗舰模型，欧洲领先的开源大语言模型，MoE 架构兼顾性能与效率。`;
  }
  if (paper.title.includes('Pixtral')) {
    return `《${titleCn}》— Mistral AI 多模态视觉语言模型，整合文本与图像理解能力。`;
  }
  if (paper.title.includes('Mistral')) {
    return `《${titleCn}》— Mistral AI 开源大语言模型，欧洲 AI 领域代表性成果。`;
  }

  // 通用回退：用标题翻译 + 厂商描述
  const titlePart = titleCn.length > 60 ? titleCn.substring(0, 60) + '...' : titleCn;
  return `《${titlePart}》— ${paper.vendor} 发布的最新研究论文。`;
}

const papers = JSON.parse(readFileSync('/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/data/papers.json', 'utf-8'));
let updated = 0;
for (const p of papers) {
  const newDesc = improveDesc(p);
  if (p.descriptionCn !== newDesc) {
    p.descriptionCn = newDesc;
    updated++;
  }
}
writeFileSync('/Users/gaojiaqiang/.openclaw/workspace/learnfordo-site/src/data/papers.json', JSON.stringify(papers, null, 2));
console.log(`✅ 优化了 ${updated} 篇论文的中文简介`);