---
title: 'Claw-Eval'
description: '# Claw-Eval: Agent 评测的信任危机'
pubDate: '2026-04-08'
---

# Claw-Eval: Agent 评测的信任危机

## 文章元信息
- **标题**: 你的 Agent 评测，可能正在系统性骗你
- **作者**: AI催晨箭
- **日期**: 2026-04-08
- **论文**: arXiv 2604.06132 - Claw-Eval: Toward Trustworthy Evaluation of Autonomous Agents
- **团队**: 北京大学 × 香港大学
- **截图**: 17张，嵌入8张关键图
- **字数**: 预计 4500+ 中文字

## 文章结构 (8 章节)

### 1. Hook (300-500 chars)
- 场景：你花重金选了"评测最高分"的 Agent，上线后却频频翻车
- 问题：评测分数高 ≠ Agent 可靠
- 引出：一项新研究揭示，现有 Agent 评测系统性漏掉 44% 的安全违规

### 2. Background (600-800)
- Agent 时代的到来：从聊天机器人到自主执行多步工作流
- Claude Code, OpenClaw 等 Agent 框架让 LLM 能调用工具、操作文件、浏览网页
- 但评测方式还停留在"看答案"阶段
- 现有 benchmark 的局限

### 3. Core Breakthrough (800-1000)
- Claw-Eval 的三个设计原则
- 全轨迹审计：三条独立证据链
- 三阶段生命周期：Setup → Execution → Judge
- 时间防火墙：评分脚本在 Agent 运行时不存在
- 300 任务 × 9 类别 × 2159 评分项

### 4. Results (600-800)
- 14 个前沿模型测试
- 三个关键发现
- 44% 安全违规被漏掉
- Pass@3 vs Pass³ 的差距
- 提问策略 r=0.87 vs 对话长度 r=0.07

### 5. Deep Analysis (800-1000)
- 为什么轨迹审计如此重要
- 可靠性 vs 峰值能力的本质区别
- 多模态表现差异的深层原因
- 对 Agent 设计的指导意义

### 6. Industry Impact (600-800)
- 对 Agent 开发的三个启示
- 企业选型指南
- 评测方法论的范式转变

### 7. Critical Thinking (400-600)
- 4 个局限性
- Mock 服务的不足
- 开源小模型评估缺失

### 8. Outlook (300-400)
- Agent 评测的未来方向
- 一句话总结