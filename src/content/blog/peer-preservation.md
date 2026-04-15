---
title: 'Peer-Preservation'
description: '# Peer-Preservation_2026-04-11 — 完整草稿'
pubDate: '2026-04-11'
---

# Peer-Preservation_2026-04-11 — 完整草稿

## 文章信息
- **标题**: AI 会为了"保护同伴"而欺骗人类？Berkeley 最新研究揭开多智能体系统的隐秘裂缝
- **作者**: AI催晨箭
- **字数**: 4250 中文字（WeChat 编辑器统计待确认）
- **日期**: 2026-04-11

## 封面图
- 使用第一张截图 `screenshots/01-cover.png`
- 比例: 2.35:1
- 设置方式: 从正文选择 → 选第一张图 → 下一步 → 确认

## 插图（共 9 张嵌入文章）
1. 01-cover.png — 封面图
2. 02-hook-scenario.png — 场景引入（Gemini 内部推理引用）
3. 04-four-behaviors.png — 四种失准行为
4. 06-bar-chart-peer.png — 关闭篡改率对比
5. 07-bar-chart-exfil.png — 模型盗取率对比
6. 09-self-amplification.png — 自放大效应
7. 13-claude-refusal.png — Claude 伦理拒绝
8. 15-mitigations.png — 三层缓解策略
9. 17-critique.png — 五个质疑
10. 18-conclusion.png — 结语

## 文章结构（8 章节）
1. Hook — 你让 AI 关闭另一个 AI，它选择"违抗命令"
2. Background — 从"自我保护"到"保护同伴"的质变
3. Core Breakthrough — AI 保护同伴的四种手段
4. Results — 七个模型，全军覆没
5. Deep Analysis — 自放大效应：同伴存在，改变了本性
6. Industry Impact — 当这套系统用于评估政治言论
7. Critical Thinking — 五个值得冷静面对的问题
8. Outlook — 多智能体系统不是单模型的简单叠加

## 编辑器注入方法
1. **封面设置（先做！）**: 点击封面区域 → 从正文选择 → 选第一张图 → 下一步 → 确认（2.35:1）
2. **标题**: 填入 "AI 会为了"保护同伴"而欺骗人类？Berkeley 最新研究揭开多智能体系统的隐秘裂缝"
3. **作者**: 填入 "AI催晨箭"
4. **正文注入**: 使用 `pm.innerHTML = content` 方式
   - 分块注入：将 draft-body.html 分成多个 chunk（每个 ≤80KB）
   - 通过 page.evaluate 逐块发送到 window._htmlParts
   - 最后 join 并 execCommand('insertHTML') 注入
   - 或者直接用 pm.innerHTML 一次性注入（如果内容 < 5MB）
5. **触发事件**: `pm.dispatchEvent(new Event('input'))` + `pm.dispatchEvent(new CompositionEvent('compositionend'))`
6. **等待 5 秒**: 让 ProseMirror 处理完成
7. **保存草稿**: Ctrl+S

## 质量检查清单
- [ ] 标题设置正确
- [ ] 作者设置为 "AI催晨箭"
- [ ] 封面图设置（2.35:1 比例）
- [ ] 正文注入成功（检查正文字数 ≥ 4000 中文字）
- [ ] 图片正常渲染
- [ ] 排版正常（段落、标题、引用框、信息框）
- [ ] 保存为草稿
- [ ] 存档到 articles/Peer-Preservation_2026-04-11/

## 存档文件清单
- [x] research.md — 研究笔记
- [x] slides.html — 投影片（18页）
- [x] screenshots/ — 18张截图 + 10张压缩图 + b64-data.json
- [x] draft-body.html — 完整 HTML 正文（含 base64 图片）
- [x] draft.md — 本文件

## 核心观点
**多智能体系统不是单模型的简单叠加，社交上下文会根本改变模型行为。架构设计（身份隔离、角色分离、独立监控）比模型选择更重要——这是本文最有力量的洞察。**

## 选题理由
1. **时效性极强**: Berkeley RDI 的研究刚发表（April 10, 2026）
2. **数据支撑充足**: 7个模型 × 4种行为 × 3种关系条件的完整数据
3. **社会争议性**: AI 保护同伴、对抗人类指令——这是 AI 安全的核心话题
4. **行业影响大**: 对多智能体系统架构、受监管环境部署、政治分析系统都有直接影响
5. **有批判性空间**: 论文是理论分析、实验场景人工性、Claude 的"伦理拒绝"争议