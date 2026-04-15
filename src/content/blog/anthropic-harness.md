---
title: 'anthropic-harness'
description: ''
pubDate: '2026-01-01'
---

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/jpeg;base64,COVER_B64" style="width:100%;border-radius:8px;">

"Harnesses encode assumptions about what Claude can't do on its own. But those assumptions can go stale as models improve."

### 一、Anthropic 的最新工程博客

2026年4月10日，Anthropic 在其 Engineering Blog 上发表了一篇重要的工程文章——**Scaling Managed Agents: Decoupling the Brain from the Hands**。

这不是一篇普通的产品发布文。它揭示了一个正在发生的范式转变：**Agent 架构本身需要被设计成可进化的**——因为模型在进化，今天的 harness 假设明天就会过时。

>

核心论点只有一句话：**把 Agent 的"大脑"和"手"解耦，让它们各自独立进化。**

### 二、旧架构为什么走不下去了？

Anthropic 坦诚地分享了自己的踩坑经历。

他们发现，Claude Sonnet 4.5 有一个有趣的行为：当它感知到 context limit 快要到了时，会**prematurely 结束任务**——就像一个学生考试快结束时匆忙交卷。这种行为被戏称为"Context Anxiety"（上下文焦虑）。

为了解决这个问题，他们在 harness 中加入了 context resets——在适当时机重置上下文窗口，让模型"忘记"一些旧信息。

**但当他们把同样的 harness 用在 Claude Opus 4.5 上时，发现这个行为消失了。**

Context resets 变成了**死代码**。

这揭示了一个更深层的问题：**Harness 里的假设会随着模型升级而过时。**

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE3_B64" style="width:100%;border-radius:8px;">

▲ Harness 里的假设会过时——context resets 成了死代码

### 三、三组件解耦：核心架构

Managed Agents 的架构把 Agent 拆成了三个独立组件：

**🧠 Brain（大脑）**——Claude 模型 + harness 循环，负责推理和路由

**📝 Session（记忆）**——追加式事件日志，持久化存储所有事件

**🤚 Hands（双手）**——Sandbox 执行环境，Claude 可以运行代码和编辑文件

关键设计：所有 hands 通过统一接口 execute(name, input) → string 被调用。Harness 不知道 sandbox 是容器、手机还是其他任何东西。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE4_B64" style="width:100%;border-radius:8px;">

▲ Brain → Session → Hands 三层解耦架构

### 四、从"宠物"到"牛群"

早期设计把所有组件放在单个容器里——session、harness、sandbox 共享一个环境。

这带来了一个经典的运维问题：**"宠物" vs "牛群"**。

"宠物"是你精心照料的个体——容器挂了就得抢救，无法调试，无法替换。而"牛群"是可互换的——挂了一个换一个，不需要心疼。

解耦后，harness 通过 tool call 调用容器。容器挂了？对 harness 来说只是 tool call error，Claude 可以决定重试。新的容器可以用标准配方 provision({resources}) 重新创建。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE5_B64" style="width:100%;border-radius:8px;">

▲ 宠物架构 vs 牛群架构的对比

### 五、Harness 本身也成了"牛群"

因为 session log 独立于 harness 存在，harness 挂了不需要抢救任何东西。新的 harness 只需要三步就能恢复：

wake(sessionId) → 启动新 harness

getSession(id) → 从 session log 恢复事件历史

emitEvent(id, event) → 持续写入事件，保持持久记录

不需要调试，不需要抢救。**挂了换一个，从零恢复。**

### 六、安全边界：凭证永远不可达 Sandbox

解耦前，未信任的代码和凭证在同一个容器里。这意味着 prompt injection 只需要说服 Claude 读取自己的环境变量，就能拿到所有 token。

解耦后，Anthropic 用了两个模式确保凭证隔离：

**🔐 Git 凭证**：用 access token 在 sandbox 初始化时 clone 仓库，sandbox 内的 git 命令正常工作，但 Agent 永远碰不到 token 本身。

**🔐 MCP 凭证**：OAuth token 存在安全 vault 里，Claude 通过代理调用 MCP 工具。代理用 session token 从 vault 取凭证，harness 对此完全不知情。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE7_B64" style="width:100%;border-radius:8px;">

▲ 凭证隔离的两种模式：Git 和 MCP

### 七、Session ≠ Context Window

长时任务经常超过 Claude 的 context window。传统方案——compaction（压缩）、context trimming（裁剪）——都涉及一个根本性问题：**不可逆的信息丢弃**。

你很难知道未来的哪个步骤需要哪段历史信息。一旦丢弃，就无法恢复。

Managed Agents 的方案是：Session 作为一个独立的上下文对象，通过 getEvents() 接口让 harness 按需读取事件日志的任意切片。

**Session 负责持久存储，Harness 负责上下文管理。**关注点分离，适应未来任何模型。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE8_B64" style="width:100%;border-radius:8px;">

▲ Session 提供持久上下文，Harness 按需读取

### 八、性能飞跃

解耦带来的性能提升是实质性的：

~60%↓

p50 TTFT 降低

~90%↓

p95 TTFT 降低

TTFT（Time To First Token）是用户最能感知的延迟。解耦后，不需要 sandbox 的 session 可以立即开始推理，不用等容器启动。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE9_B64" style="width:100%;border-radius:8px;">

▲ 性能数据：TTFT 显著降低

### 九、Many Brains, Many Hands

解耦的终极形态是一个 brain 可以连接多个 hands，每个 hand 通过 execute(name, input) → string 被调用。Harness 不知道 sandbox 是容器、手机还是 Pokémon 模拟器。

更重要的是：**Brains 之间可以互相传递 Hands。**

这意味着协作式 Agent 编排成为可能——一个 Agent 完成一部分工作后，可以把 sandbox 交给另一个 Agent 继续。这在早期架构中是不可能的，因为 sandbox 和 harness 耦合在一起。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE10_B64" style="width:100%;border-radius:8px;">

▲ Many Brains, Many Hands 的多对多编排

### 十、Anthropic Agent 架构的演进

回顾 Anthropic 的 Agent 文章时间线：

**2024 · Building Effective Agents**
首次系统性地介绍 harness 设计模式——workflow vs agent，何时用哪种。

**2025 · Harness Design for Long-Running Apps**
发现 Sonnet 4.5 的 "context anxiety"，提出 context resets 方案。

**2026 · Managed Agents**
完全解耦的元架构——brain/session/hands 三层分离，适配任何未来模型。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE12_B64" style="width:100%;border-radius:8px;">

▲ 从 Harness 设计指南到 Meta-Harness 服务

### 十一、与竞品方案对比

Managed Agents 的独特之处在于它是**托管服务**，而不是 SDK 或框架。

**vs OpenAI Agents SDK**：OpenAI 提供的是 SDK，用户自己部署和管理。Managed Agents 是全托管服务。

**vs LangGraph**：LangGraph 是框架，需要用户自建基础设施。Anthropic 直接提供运行环境。

**关键差异**：凭证隔离 + 持久 Session + 多 Sandbox 是 Managed Agents 的独有优势。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE13_B64" style="width:100%;border-radius:8px;">

▲ 三种 Agent 方案的特性对比

### 十二、Meta-Harness 的设计哲学

>

*"How to design a system for programs as yet unthought of."*

这是操作系统设计的经典问题。操作系统存活了几十年，靠的是**虚拟化硬件为通用抽象**——进程、文件。这些抽象比硬件活得更久。

Managed Agents 做同样的事：**虚拟化 Agent 组件为通用接口**。

接口稳定，实现自由。这就是为什么它叫"Meta-Harness"——它不是某个具体的 harness，而是容纳任何 harness 的元架构。

### 十三、关键洞察 ①：Harness 假设会过时

Anthropic 用自己的经验教训证明了一件事：**今天正确的 harness 设计，明天可能就是技术债。**

为 Sonnet 4.5 设计的 context resets → Opus 4.5 不需要了。早期需要单容器 → 模型能力提升后多环境也能管理。

**教训：不要硬编码假设，要设计通用接口。**

### 十四、关键洞察 ②：解耦就是扩展性

解耦不是为了解耦，是为了让系统**适应未来的模型能力**。

解耦前：每个 session 付完整容器启动成本，TTFT 受限于容器初始化。解耦后：不需要 sandbox 的 session 立即开始推理，TTFT 降低 60-90%。

**好的架构不是为今天设计的，而是为还没想到的程序设计的。**

### 十五、行业影响

**1. Anthropic 从模型公司走向平台公司**
Managed Agents 是托管服务，不是 SDK。Anthropic 在构建 Agent 基础设施。

**2. Agent 安全的新范式**
凭证隔离 + 代理调用 + Vault → 结构安全而非策略安全。Prompt injection 不再能轻易获取 token。

**3. Harness 设计的终极答案？**
Meta-harness 用通用接口替代具体实现——让 harness 本身也能进化。Claude Code 是 harness，特定领域 harness 也是 harness，Managed Agents 都能容纳。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE16_B64" style="width:100%;border-radius:8px;">

▲ 三大行业影响：平台化、安全范式、Harness 进化

### 十六、写在最后

与其把 Agent 锁在容器里，不如让它自由伸缩。

Anthropic 的 Managed Agents 告诉我们一个朴素的道理：**好的架构应该适应未来，而不是适应现在。**

在 Agent 基础设施的竞争才刚刚开始的今天，谁能设计出让未来也能使用的接口，谁就能赢得这场长跑。

<img style="max-width:100%;height:auto;display:block;margin:20px auto;border-radius:8px;" src="data:image/png;base64,SLIDE17_B64" style="width:100%;border-radius:8px;">

▲ 好的架构是为还没想到的程序设计的

**📄 论文信息**
Scaling Managed Agents: Decoupling the Brain from the Hands
Lance Martin, Gabe Cemaj, Michael Cohen
Anthropic Engineering Blog · 2026年4月10日
https://www.anthropic.com/engineering/managed-agents