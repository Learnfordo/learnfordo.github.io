---
title: 'OpenClaw Context Engineering 完整链路文档'
description: '本文档基于 OpenClaw 源码逆向分析，覆盖从消息到达 Gateway 到最终响应的完整生命周期：主链路、Skills 子系统、Memory 子系统、错误处理、Provider 抽象层、Hook 体系、Fallback 链路等七大模块。'
pubDate: '2026-04-29'
---

# OpenClaw Context Engineering 完整链路文档

版本: v2026.4.15-final | 作者: LuffyUp | 日期: 2026-04-29

本文档基于 OpenClaw 源码逆向分析，覆盖从消息到达 Gateway 到最终响应的完整生命周期。

包含：主链路 + Skills 子系统 + Memory 子系统 + 错误处理 + Provider 抽象层 + Hook 体系 + Fallback 链路

## 目录

- Phase 0: 消息到达

- Phase 1: 预处理（Pre-processing）

- Phase 2: System Prompt 组装

- Phase 3: 压缩触发判断（Preemptive Compaction）

- Phase 4: LLM 请求构建与调用

- Phase 5: Tool Loop（ReAct 循环）

- Phase 6: 后处理（Post-processing）

- Skills 子系统

- Memory 子系统

- 错误处理路径

- Provider 抽象层

- 完整 Hook 体系

- Fallback 链路详解

- 附录 A: 完整实例——&ldquo;帮我查一下杭州天气&rdquo;

- 附录 B: 关键源码文件映射

- 附录 C: 你的实际配置快照

- 设计要点总结

## Phase 0: 消息到达

### 0.1 消息流转路径

用户发送消息
  ↓
Gateway (Node.js daemon) 接收到 WebSocket/HTTP 请求
  ↓
channel-runtime → 创建 InboundContext
  ↓
inbound-reply-dispatch.ts → dispatchReplyFromConfig()
  ↓
get-reply-XW5nFnK2.js → getReplyFromConfig()
  ↓
get-reply-XW5nFnK2.js → runPreparedReply()
  ↓
pi-embedded-runner-DN0VbqlW.js → runEmbeddedAttempt()
  ↓
Pi Coding Agent (embedded) → 实际 LLM 交互

### 0.2 核心入口函数

**dispatchReplyFromConfig** (dispatch-JNo_iJw5.js:237)

这是所有入站消息的通用入口。无论消息来自 webchat、Discord、Telegram 还是其他渠道，最终都走这里。

关键步骤：

1. **Inbound deduplication** — 检查重复消息（同一 MessageSid 30秒内只处理一次）

2. **Session store lookup** — 根据 SessionKey 找到 session 文件路径

3. **Plugin binding check** — 检查是否有插件绑定了这个 conversation（如插件托管模式）

4. **Fast abort** — 如果是 /stop 命令，立即终止子代理

5. **Hook trigger** — 触发 message_received 插件 hook

6. **进入 getReplyFromConfig**

### 0.3 你的实际配置

{
  "channel": "webchat",
  "sessionKey": "e4205302-4b21-439e-805e-208cd0df6647",
  "agentId": "main"
}

## Phase 1: 预处理（Pre-processing）

### 1.1 配置加载与模型解析

**getReplyFromConfig** (get-reply-XW5nFnK2.js:3189)

1. 加载 openclaw.json 配置
2. 解析默认模型: provider="alibaba", modelId="glm-5.1"
3. 检查心跳模型覆盖（heartbeat.model）
4. 检查 session 存储的模型覆盖（sessionEntry.modelOverride）
5. 检查渠道模型覆盖（channel model override）
6. 最终确定 provider + model

### 1.2 Session 状态初始化

**initSessionState** → useFastTestBootstrap ? initFastReplySessionState : await initSessionState

初始化以下状态：

- sessionKey — 当前会话标识

- sessionId — Pi 内部 session ID（UUID）

- sessionEntry — session store 中的持久化状态

- sessionFile — JSONL 文件路径

- isNewSession — 是否是新会话

- resetTriggered — 是否触发了 /reset

### 1.3 指令解析

**resolveReplyDirectives** — 解析用户消息中的 inline 指令：

指令
效果

/think high
切换 thinking level

/reasoning on
开启 reasoning

/verbose
开启 verbose 输出

/model alibaba/glm-5.1
切换模型

/new or /reset
重置会话

### 1.4 Bootstrap 上下文注入

这是整个 context engineering 的第一道防线。

**resolveBootstrapContextForRun** (bootstrap-files-ZYTN7n8L.js)

#### 1.4.1 Bootstrap 文件加载顺序

loadWorkspaceBootstrapFiles(workspaceDir)
  → 按固定顺序扫描:
    1. AGENTS.md      (order=10)
    2. SOUL.md        (order=20)
    3. TOOLS.md       (order=50)
    4. IDENTITY.md    (order=30)
    5. USER.md        (order=40)
    6. HEARTBEAT.md   (dynamic, order=MAX)
    7. BOOTSTRAP.md   (order=60)
    8. MEMORY.md      (order=70, 或 memory.md)

**关键行为：**

- 文件不存在 → 注入 [MISSING] Expected at: <path>

- 文件读取失败（权限/文件锁）→ 同&rdquo;不存在&rdquo;，注入 [MISSING]

- 文件存在但为空 → 注入空内容（不注入 [MISSING]，LLM 感知文件存在）

- HEARTBEAT.md 不存在 → 不注入 [MISSING]，改为注入默认心跳提示词

- 子代理/Cron session → 只加载最小集合 (AGENTS, TOOLS, SOUL, IDENTITY, USER)

- 非默认 agent → 不加载 HEARTBEAT.md

- lightweight mode → 只保留 HEARTBEAT.md

#### 1.4.2 预算截断

**buildBootstrapContextFiles** (pi-embedded-helpers-6UMMUO8y.js:130)

per-file limit:  maxChars      = 12,000 chars（默认）
total limit:     totalMaxChars = 60,000 chars（默认）
min budget:      MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 256
head ratio:      BOOTSTRAP_HEAD_RATIO = 0.6
tail ratio:      BOOTSTRAP_TAIL_RATIO = 0.4

截断策略：

1. 超出 maxChars → 头尾保留（60%头 + 40%尾），中间插入 [...truncated...]

2. 超出 totalMaxChars → 整文件被截断到剩余预算内

3. 剩余预算 < 256 → 跳过后续文件

**你的配置：**

{
  "bootstrapMaxChars": 12000,
  "bootstrapTotalMaxChars": 60000,
  "bootstrapPromptTruncationWarning": "once"
}

#### 1.4.3 Bootstrap Hook

applyBootstrapHookOverrides — 允许插件通过 agent:bootstrap internal hook 修改 bootstrap files 列表。

### 1.5 心跳提示词注入

**resolveHeartbeatPromptForSystemPrompt** (bootstrap-files-ZYTN7n8L.js)

条件：

- 当前 agent 是默认 agent

- heartbeat 配置中 includeSystemPromptSection !== false

- heartbeat cadence > 0（默认 30m）

注入内容：读取 HEARTBEAT.md 文件内容（如果存在），否则注入默认提示：

Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.

## Phase 2: System Prompt 组装

这是 context engineering 最核心的环节。所有指令、工具说明、上下文文件都在这里拼接。

### 2.1 调用链

runEmbeddedAttempt()
  → buildEmbeddedSystemPrompt(params)
    → buildAgentSystemPrompt(params)
      → 拼接所有 sections

### 2.2 完整拼接顺序

buildAgentSystemPrompt (system-prompt-D8lixhp6.js:260) 的输出按以下顺序拼接：

[1]  "You are a personal assistant running inside OpenClaw."

[2]  "## Tooling"
      工具列表（按固定顺序，25个）
      "TOOLS.md does not control tool availability..."
      "For long waits, avoid rapid poll loops..."
      [ACP harness instructions if enabled]

[3]  [provider override: interaction_style]

[4]  "## Tool Call Style"
      工具调用风格指南

[5]  [provider override: execution_bias]

[6]  [provider stable prefix]

[7]  "## Safety"
      "You have no independent goals..."

[8]  "## OpenClaw CLI Quick Reference"

[9]  "## Skills (mandatory)"
      Before replying: scan <available_skills>...
      <available_skills>
        [skill 列表，含名称、描述、requires]
      </available_skills>

[10] "## 🧠 MEMORY.md / 📝 Write It Down"
      memory_search / memory_get 使用规则
      写入时机指引

[11] "## OpenClaw Self-Update"（如果有 gateway 工具）

[12] "## Model Aliases"（如果有别名）

[13] [timezone hint]
      "## Workspace"
      "Your working directory is: /Users/.../.openclaw/workspace"

[14] "## Documentation"

[15] "## Sandbox"（如果 sandbox 启用）

[16] "## Authorized Senders"（如果有 ownerNumbers）

[17] "## Current Date & Time"（如果有 timezone）

[18] "## Workspace Files (injected)"

[19] "## Assistant Output Directives"
      MEDIA:, [[audio_as_voice]], [[reply_to_current]] 等

[20] "## Control UI Embed"（webchat 专用）

[21] "## Messaging"

[22] "## Voice (TTS)"（如果有 TTS hint）

[23] [Reactions guidance]（如果启用）

[24] [Reasoning Format]（如果 reasoningTagHint）
      强制使用 <thinking>...</thinking> + <final>...</final>

--- SYSTEM_PROMPT_CACHE_BOUNDARY ---
     （Anthropic cache_control 分界线；alibaba provider 下作为普通文本出现）

[25] "# Project Context"（稳定上下文文件）
      AGENTS.md → SOUL.md → IDENTITY.md → USER.md
      → TOOLS.md → BOOTSTRAP.md → MEMORY.md
      （按 CONTEXT_FILE_ORDER 排序）

[26] "## Silent Replies"
      "When you have nothing to say, respond with ONLY: NO_REPLY"

[27] "<!-- OPENCLAW_CACHE_BOUNDARY -->"

[28] "# Dynamic Project Context"
      HEARTBEAT.md（唯一动态文件）

[29] "## Group Chat Context" / "## Subagent Context"
      [extraSystemPrompt if any]

[30] [provider dynamic suffix]

[31] "## Heartbeats"
      [heartbeatPrompt content]

[32] "## Runtime"
      "Runtime: agent=main | host=... | model=alibaba/glm-5.1"
      "channel=webchat | capabilities=none | thinking=low"
      "Reasoning: off (hidden unless on/stream)..."

### 2.3 关键设计

**Stable vs Dynamic 分离：**

- SYSTEM_PROMPT_CACHE_BOUNDARY 之前 → Anthropic cache_control 缓存（prefix）

- SYSTEM_PROMPT_CACHE_BOUNDARY 之后 → 每轮可能变化（suffix）

- OPENCLAW_CACHE_BOUNDARY → 标记 Project Context 结束

**Context File Order：**

const CONTEXT_FILE_ORDER = new Map([
  ["agents.md",    10],
  ["soul.md",      20],
  ["identity.md",  30],
  ["user.md",      40],
  ["tools.md",     50],
  ["bootstrap.md", 60],
  ["memory.md",    70]
]);

**动态文件：**

- DYNAMIC_CONTEXT_FILE_BASENAMES = {"heartbeat.md"} — 唯一标记为动态的文件

- 动态文件放在 OPENCLAW_CACHE_BOUNDARY 之后，确保不被缓存

## Phase 3: 压缩触发判断（Preemptive Compaction）

在发送 LLM 请求之前，OpenClaw 会评估当前上下文是否会溢出。

### 3.1 触发条件

**shouldPreemptivelyCompactBeforePrompt** (pi-embedded-runner-DN0VbqlW.js:5400)

输入:
  - messages: 当前 session 中的所有消息（含 system prompt）
  - systemPrompt: 刚组装的系统提示
  - prompt: 当前用户消息
  - contextTokenBudget: 模型 context window（默认 200,000）
  - reserveTokens: 40,000（你的配置）

计算:
  1. estimatedPromptTokens = estimateMessagesTokens(messages)
     + estimateTokens(systemPrompt) + estimateTokens(prompt)
     （estimateMessagesTokens 对每条消息取 JSON.stringify 后 / 4）
  2. estimatedPromptTokens *= SAFETY_MARGIN (1.1)   ← 10% 安全余量
  3. minPromptBudget = min(8000, contextWindow * 0.5)
  4. effectiveReserve = min(reserveTokens, contextWindow - minPromptBudget)
  5. promptBudgetBeforeReserve = contextWindow - effectiveReserve
  6. overflowTokens = max(0, estimatedPromptTokens - promptBudgetBeforeReserve)

### 3.2 决策路线

overflowTokens > 0?
  │
  ├─ No  → route = "fits"，直接进入 Phase 4
  │
  └─ Yes
       │
       ├─ toolResultReducibleChars <= 0
       │    → "compact_only"（无可截断工具结果，只能压缩）
       │
       └─ toolResultReducibleChars > 0
            │
            ├─ 截断能完全消化溢出 → "truncate_tool_results_only"
            │
            └─ 截断不足以消化溢出 → "compact_then_truncate"

### 3.3 你的实际场景

模型:  alibaba/glm-5.1 → context window = 200,000 tokens
配置:  reserveTokens = 40,000
计算:
  promptBudgetBeforeReserve = 200,000 - 40,000 = 160,000 tokens
  minPromptBudget = min(8,000, 100,000) = 8,000 tokens

典型 session（system prompt ~8,750 tokens + 15条历史 ~3,000 tokens）:
  estimatedPromptTokens ≈ (8,750 + 3,000 + 10) × 1.1 ≈ 12,925 tokens
  → 远低于 160,000，不触发压缩

## Phase 4: LLM 请求构建与调用

### 4.1 请求组装

runEmbeddedAttempt()
  → prepareCompactionSessionAgent()
    → resolveEmbeddedAgentStreamFn()
      → resolveProviderStreamFn()
        → 最终调用 provider 的 streaming API

### 4.2 Pi Session 初始化

**runEmbeddedAttempt** (pi-embedded-runner-DN0VbqlW.js:5501)

1. 创建工作区目录
2. 解析沙箱配置
3. 加载技能（skills）
4. 解析 bootstrap 上下文
5. 构建 system prompt
6. 初始化 Pi Agent
7. 设置 compaction safeguard runtime
8. 设置 tool result context guard
9. 设置 context pruning（cache-ttl 模式，仅 Anthropic）
10. 运行 agent

### 4.3 Compaction Safeguard Runtime

**setCompactionSafeguardRuntime** (pi-hooks/compaction-safeguard-runtime.ts)

{
  maxHistoryShare: 0.5,         // 历史消息最多占 50% context window
  contextWindowTokens: 200000,
  identifierPolicy: "strict",
  qualityGuardEnabled: true,
  qualityGuardMaxRetries: 2,
  model: "alibaba/glm-5.1",
  recentTurnsPreserve: 3,       // 保留最近 3 轮
  provider: "alibaba"
}

### 4.4 Tool Result Context Guard

**installToolResultContextGuard** (model-context-tokens-z5hvDVkk.js:2698)

{
  maxContextChars:          contextWindow * 4 * 0.5,   // ~400,000 chars
  maxSingleToolResultChars: contextWindow * 4 * 0.3    // ~240,000 chars
}

拦截逻辑：

1. 在 Pi 的 transformContext hook 中拦截

2. 单条 tool result 超过 maxSingleToolResultChars → 截断，插入 [TOOL RESULT TRUNCATED]

3. 总体超过 maxContextChars → 抛出 PREEMPTIVE_CONTEXT_OVERFLOW

### 4.5 Context Pruning（Anthropic 专属）

你的 provider (alibaba) 不支持 cache-ttl，此步骤跳过。

## Phase 5: Tool Loop（ReAct 循环）

### 5.1 标准循环

用户消息 → LLM → tool_call?
                    │
              Yes ──┤
                    ↓
               执行 tool
                    ↓
              tool_result 注入 session
                    ↓
              LLM 再次调用
                    ↓
              ...循环直到无 tool_call
                    │
              No ───┤
                    ↓
               最终文本回复

### 5.2 Tool Result 截断（运行中）

**truncateToolResultText** (model-context-tokens-z5hvDVkk.js)

长度 <= maxChars → 原样返回

长度 > maxChars:
  ├─ 尾部含重要信号词（error/failed/traceback/exception/warning/fatal）
  │    → 头尾保留策略
  │       headBudget = 70% × (maxChars - suffix_len)
  │       tailBudget = 30% × (maxChars - suffix_len)
  │       中间插入: "\n[...output truncated...]\n"
  │
  └─ 尾部无重要信号词
       → 头部保留策略
          cutPoint = maxChars - suffix_len（在最近换行符处截断，若 > 80% budget）
          插入: "\n[...truncated, use a more specific query...]\n"

极端情况（超过 maxSingleToolResultChars ~240,000 chars）:
  → Context Guard 直接截断，不走上述两级逻辑
  → 插入: "\n[TOOL RESULT TRUNCATED: exceeded single result limit]\n"
  → 截断后总量仍超 maxContextChars → 抛出 PREEMPTIVE_CONTEXT_OVERFLOW

### 5.3 Session Manager 守卫

**guardSessionManager** (model-context-tokens-z5hvDVkk.js)

- 在 assistant message 之前 flush pending tool results

- 在新 tool call 之前 flush

- 确保 tool result 不堆积

### 5.4 Thinking Block 处理

**dropThinkingBlocks** (model-context-tokens-z5hvDVkk.js)

- reasoningLevel === "off" → 剥离 thinking block，只保留 final

- reasoningLevel !== "off" → 保留但标记为 hidden（不展示给用户）

- alibaba provider：LLM 生成的 <thinking>...</thinking> 标签同样被此函数识别处理

## Phase 6: 后处理（Post-processing）

### 6.1 Compaction 触发（运行时）

Pi 内部检测到上下文接近上限 → 触发 session_before_compact hook

**Safeguard 模式流程：**

Pi: session_before_compact
  ↓
OpenClaw: compactionSafeguardExtension
  ↓
1. splitPreservedRecentTurns()     → 保留最近 3 轮
2. buildCompactionStructureInstructions()
     → 生成结构化摘要指令:
        Decisions / TODOs / Constraints / Pending asks / Exact identifiers
3. summarizeViaLLM()
     → summarizeInStages()（历史过长时分 chunk）
        → 每 chunk 调用 summarizeWithFallback()（见 Fallback 章节）
     → mergeChunkSummaries()
        → 合并后超长 → 对摘要再做一次 summarize
4. 拼接 suffix:
     preservedRecentTurns + toolFailures + fileOps + workspaceContext
5. capCompactionSummaryPreservingSuffix() → 上限 16,000 chars（尾部截断）
6. 写入 compaction entry，替换原始消息

### 6.2 Post-Compaction 刷新

**readPostCompactionContext** (post-compaction-context.ts:3568)

压缩完成后注入：

[Post-compaction context refresh]

Session was just compacted. The conversation summary above is a hint,
NOT a substitute for your startup sequence. Run your Session Startup
sequence - read the required files before responding to the user.

Critical rules from AGENTS.md:
[AGENTS.md 的 Session Startup 和 Red Lines 章节]

### 6.3 Session 文件写入

每轮对话以 JSONL 格式追加：

{"type":"message","role":"user","content":[...]}
{"type":"message","role":"assistant","content":[...],"tool_calls":[...]}
{"type":"tool_result","toolResult":{...}}
{"type":"compaction","summary":"...","firstKeptEntryId":"..."}

### 6.4 副作用

**runPostCompactionSideEffects** (model-context-tokens-z5hvDVkk.js:5923)

1. emitSessionTranscriptUpdate(sessionFile) → 触发 transcript 索引更新
2. syncPostCompactionSessionMemory()        → 同步 memory 索引

## Skills 子系统

### Skills 是什么

Skill 是对 tool 的更高层封装。tool 是原子操作（exec、web_fetch 等），skill 是&rdquo;有名字、有描述、可被 LLM 感知的复合能力单元&rdquo;。LLM 不直接看到 skill 实现，而是通过 system prompt 的 ## Skills (mandatory) 区块感知它们的存在。

### Skill 注册机制

openclaw.json → skills[] 字段
  ↓
loadSkillsForAgent() (skill-loader.ts)
  ↓
  1. 扫描 skills/ 目录下的 .skill.md / .skill.js 文件
  2. 解析 frontmatter（name, description, trigger_patterns, requires_tools[]）
  3. 过滤: 当前 agent 权限 + 所需 tool 是否可用（TOOLS.md 不控制 skill 可用性）
  4. 返回 SkillManifest[]

### System Prompt 注入格式

## Skills (mandatory)

Before replying, scan <available_skills> for relevant capabilities.
Prefer skills over raw tool calls when a skill name matches the intent.

<available_skills>
- weather:       查询城市天气，支持中英文城市名。requires: web_fetch
- memory_recall: 从长期记忆检索相关内容。requires: memory_search, memory_get
- image_gen:     生成图片。requires: image_generate
- ...（共 12 个）
</available_skills>

### Skill 执行路径

Skill **没有独立的执行引擎**。LLM 感知 skill 名称和描述后，在 Tool Loop 里自主编排底层 tool 调用：

普通 tool call:
  LLM → tool_call(exec, {cmd}) → 执行 → tool_result → LLM

Skill 引导的 tool call:
  LLM 感知 skill "weather"
    → tool_call(web_fetch, {url: "wttr.in/杭州?format=j1"})
    → tool_result（JSON 天气数据）
    → LLM 解析，生成自然语言回复
  （OpenClaw 不介入中间步骤）

### Skill 失败处理

Skill 没有独立错误捕获。底层 tool 失败后 LLM 自主决策（重试、改用其他 tool、告知用户）。建议在 skill description 里加入失败场景的引导语以提高稳定性。

## Memory 子系统

### 两层结构

Layer 1: MEMORY.md（静态注入）
  · 每次 session 启动注入 system prompt
  · 受 bootstrapMaxChars = 12,000 chars 限制
  · 人工或 LLM 在压缩后更新

Layer 2: memory_search / memory_get（动态检索）
  · 结构化条目，存储在 ~/.openclaw/memory/
  · LLM 主动调用，非自动注入
  · 支持向量检索 + 全文检索

### Memory 写入时机

由 system prompt 的 📝 Write It Down 规则引导，LLM 在以下情况写入：

1. 用户明确要求记住某事

2. LLM 判断信息具有跨 session 价值（用户偏好、关键标识符等）

3. Compaction 触发时 — syncPostCompactionSessionMemory() 自动提取关键信息

### 检索机制

memory_search(query, options)
  ↓
  1. 向量检索（若配置 embedding backend）
     → embed(query) → 余弦相似度 top-k
  2. 全文检索（fallback 或默认）
     → BM25 / 字符串匹配
  3. 合并结果，按 score 排序

memory_get(id) → 读取具体条目内容

**向量 vs 全文：** 取决于 openclaw.json 的 memory.backend。默认纯全文，配置 embedding endpoint 后启用向量检索。向量 API 失败时静默降级到全文。

### syncPostCompactionSessionMemory 行为

压缩完成后:
  → 读取 compaction summary
  → 提取结构化字段:
      Exact identifiers / Decisions / TODOs
  → 对比现有条目，避免重复写入
  → 将新增条目写入 memory index
  → （可选）更新 MEMORY.md（auto-update-memory-file 配置）

### 局限性

- MEMORY.md 是静态快照，不实时同步

- memory_search 召回质量依赖 LLM 的 query 质量

- 无内置去重/老化机制，长期使用后 MEMORY.md 可能触碰 12,000 chars 上限

## 错误处理路径

### LLM 调用失败

resolveProviderStreamFn() → API 失败
  ↓
  · 网络错误 / 5xx → exponential backoff 重试（最多 3 次）
  · 4xx（401/429）  → 不重试，直接抛出
  · 超时（默认 120s）→ 按网络错误处理

retry 耗尽:
  → 检查 fallback_provider 配置（见 Fallback 章节）
  → 无配置 → 向用户报错，session 标记 idle

### Tool 执行失败

Tool 失败**不终止 Tool Loop**：

tool_call → 失败
  ↓
tool_result: { error: "...", success: false }
  ↓
LLM 再次调用 → 自主决策:
  a) 用不同参数重试
  b) 改用其他 tool
  c) 向用户报告失败

Compaction Safeguard 在生成摘要时会提取历史 tool failure 记录，附加到摘要 suffix，避免下一 session 重复同样的失败。

### PREEMPTIVE_CONTEXT_OVERFLOW

Context Guard 检测到总量溢出
  ↓
抛出 PREEMPTIVE_CONTEXT_OVERFLOW
  ↓
pi-embedded-runner 捕获
  ↓
强制触发 compaction（不等 Pi 内部检测）
  ↓
压缩完成后重新发起本轮请求
  ↓
压缩后仍溢出 → 报错给用户（"上下文过长，请 /reset"）

### Compaction Quality Guard 失败

qualityGuard 检查（长度/identifiers/结构字段）
  ↓
失败 → 重试（最多 2 次）
  ↓
2 次后仍失败 → 强制使用最后一次结果
  ↓
写入 warning 到 session log（不阻断流程）

### Session 文件损坏

JSONL 读取失败（parse error / 文件锁）
  ↓
1. 尝试逐行读取，跳过损坏行
2. 无法恢复 → 创建新 session（isNewSession = true）
3. 保留损坏文件为 .bak 备份
4. 向用户提示 session 已重置

## Provider 抽象层

### Provider 注册结构

providers/
  ├── anthropic/
  │   ├── stream.ts        ← SSE 流式处理
  │   ├── cache-control.ts ← cache_control 注入
  │   └── thinking.ts      ← thinking block 处理
  ├── alibaba/
  │   ├── stream.ts        ← OpenAI-compatible SSE
  │   └── model-map.ts     ← modelId 映射
  └── openai/

resolveProviderStreamFn() 根据 provider 字段动态 require 对应模块。

### 各 Provider 关键差异

特性
anthropic
alibaba（OpenAI-compat）
openai

cache_control
✅ 原生支持
❌ 忽略
❌ 忽略

thinking block
✅ 原生
❌ 模拟（<thinking> 标签）
❌ 不支持

context-pruning (cache-ttl)
✅
❌
❌

流式格式
Anthropic SSE
OpenAI SSE
OpenAI SSE

tool_call 格式
tool_use block
function_call
function_call

### Anthropic 专属：cache_control 注入

// SYSTEM_PROMPT_CACHE_BOUNDARY 被转换为:
messages = [
  {
    role: "system",
    content: [
      { type: "text", text: stablePart,  cache_control: { type: "ephemeral" } },
      { type: "text", text: dynamicPart }  // 不缓存
    ]
  },
  ...userMessages
];

alibaba provider 下，SYSTEM_PROMPT_CACHE_BOUNDARY 作为普通文本出现，不影响功能但略显冗余。

### alibaba 的 thinking 模拟

provider_override: interaction_style
  → system prompt 注入:
     "When reasoning is needed, wrap your internal reasoning in
      <thinking>...</thinking> tags before your final answer."

dropThinkingBlocks():
  → 识别 <thinking>...</thinking>
  → 按 reasoningLevel 决定保留或剥离
  → 注入 session 时标记为 hidden

### Provider 动态 Suffix（示例）

alibaba 默认 suffix（Phase 2 [30]）：

请用中文回复，除非用户明确要求其他语言。
工具调用时使用英文参数名。

## 完整 Hook 体系

### 三层总览

Layer 1: 插件 Hook（Plugin Hooks）
  → openclaw 插件通过 registerHook() 注册，异步，可阻断

Layer 2: Internal Hook（OpenClaw 内部模块间）
  → 内部事件总线，同步/异步均有，不对外暴露

Layer 3: Pi Hook（Pi Agent 内部）
  → OpenClaw 通过 Pi SDK 注入的生命周期 hook

### 插件 Hook 完整列表

Hook 名称
触发时机
可阻断
常见用途

message_received
消息到达、去重后
✅
消息过滤、指令拦截

before_reply
LLM 调用前
✅
注入额外 context、修改 prompt

after_reply
最终回复生成后
❌
日志、统计

tool_before_exec
tool 执行前
✅
权限检查、参数校验

tool_after_exec
tool 执行后
❌
结果审计

session_reset
/reset 触发后
❌
清理插件状态

agent:bootstrap
bootstrap 文件加载后
✅
修改/追加 bootstrap files

compaction_before
压缩开始前
✅
注入额外保留内容

compaction_after
压缩完成后
❌
触发外部同步

heartbeat_tick
心跳轮询触发时
✅
自定义心跳逻辑

channel_send
向 channel 推送消息前
✅
消息格式转换、富媒体注入

### Internal Hook 完整列表

Hook 名称
触发位置
说明

session:before_write
JSONL 写入前
可修改写入内容

session:after_write
JSONL 写入后
触发索引更新

context:overflow
PREEMPTIVE_CONTEXT_OVERFLOW 时
触发强制压缩

memory:before_write
memory 条目写入前
去重检查

memory:after_index
memory 索引更新后
触发向量 embed

skill:resolved
skill 列表确定后
debug/监控

provider:request_built
LLM 请求体构建完成
最后修改机会

provider:response_chunk
流式响应每个 chunk
实时处理

### Pi Hook（OpenClaw 注入点）

Pi Hook
OpenClaw 注入内容

transformContext
Tool Result Context Guard（截断/溢出检测）

session_before_compact
Compaction Safeguard（接管压缩逻辑）

onToolCall
guardSessionManager（flush pending results）

onAssistantMessage
dropThinkingBlocks（thinking block 处理）

onSessionEnd
session JSONL 最终写入 + side effects

## Fallback 链路详解

OpenClaw 的 fallback 分布在六个独立层面，没有统一的 fallback 总线。

### Provider 级 Fallback

主 provider retry 耗尽
  ↓
fallback_provider 已配置?
  ├─ No  → 直接报错，session idle
  └─ Yes → 切换 fallback provider
             ↓
             重建 system prompt
             （cache_control 等特性静默丢失）
             ↓
             重新发起 LLM 请求
             ↓
             fallback 也失败 → 不再继续，直接报错

注意：fallback provider 的 context window 如果小于主 provider，OpenClaw 不自动处理，需手动配置。

### Compaction Summarize Fallback（三级）

summarizeWithFallback()
  ↓
尝试 1: safeguard 专用 system prompt + 结构化指令
  → qualityGuard 检查（长度/identifiers/结构字段）
  → 通过 → 使用

尝试 2（失败）: 降低结构化要求，放宽 qualityGuard 标准
  → 移除 Exact identifiers 强制要求

尝试 3（再次失败）: Pi 内置 generateSummary()
  → 使用原始 SUMMARIZATION_SYSTEM_PROMPT
  → 跳过 qualityGuard，强制使用结果

**分 chunk 合并：**

chunk_1_summary + ... + chunk_n_summary
  ↓
合并后 < 16,000 chars → 直接拼接
合并后超限 → 对摘要再做一次 summarizeWithFallback()
最终由 capCompactionSummaryPreservingSuffix() 强制截至 16,000 chars

### Memory Backend Fallback

memory_search() 调用
  ↓
向量检索（embedding API）
  ↓
API 失败/超时 → 静默 fallback 到全文检索
  → session log 写入 warning，用户不可见

全文检索失败（文件系统错误）:
  → 返回空结果
  → LLM 感知"未找到记忆"，自行决定回答策略

### Bootstrap 文件 Fallback

情况
处理方式
用户可见

文件不存在
注入 [MISSING] Expected at: <path>
⚠️ LLM 感知

文件读取失败
同上
⚠️ LLM 感知

文件存在但为空
注入空内容
❌

HEARTBEAT.md 不存在
注入默认心跳提示词
❌

### Tool Result 截断 Fallback（三级）

Level 1（truncateToolResultText）:
  尾部有错误信号词 → 头尾保留（70% head + 30% tail）
  尾部无错误信号词 → 头部保留，尾部截断

Level 2（Context Guard 单条限制）:
  超过 maxSingleToolResultChars（~240,000 chars）
  → 强制截断，插入 [TOOL RESULT TRUNCATED]

Level 3（Context Guard 总量限制）:
  截断后总量仍超 maxContextChars（~400,000 chars）
  → 抛出 PREEMPTIVE_CONTEXT_OVERFLOW → 触发强制压缩

### Skill Fallback

Skill 无独立 fallback 引擎，完全依赖 LLM 在 Tool Loop 内的自主推理：

skill 底层 tool 失败
  ↓
tool_result: { error: "..." }
  ↓
LLM 自主决策:
  a) 换参数/URL 重试
  b) 改用其他 tool（如 web_search 替代 web_fetch）
  c) 从 MEMORY.md / 历史对话推断
  d) 告知用户无法获取

### Fallback 全景对比

层级
触发条件
用户可见
静默处理
可配置

Provider
retry 耗尽
✅ 报错
❌
✅ fallback_provider

Compaction 摘要
quality guard 失败
❌
✅
❌（内置三级）

Memory 向量检索
embedding API 失败
❌
✅
❌（自动降级）

Bootstrap 文件
文件缺失/读取失败
⚠️ [MISSING]
部分
❌

Tool Result 截断
超过长度上限
⚠️ truncated 标记
部分
✅ maxChars

Skill
底层 tool 失败
视 LLM 决策
视 LLM 决策
⚠️ 靠描述引导

## 附录 A: 完整实例——&ldquo;帮我查一下杭州天气&rdquo;

### A.1 消息到达

时间: 2026-04-29 14:50:00 CST
渠道: webchat
SessionKey: e4205302-4b21-439e-805e-208cd0df6647
消息内容: "帮我查一下杭州天气"

### A.2 预处理

Gateway 接收 HTTP POST → WebSocket 推送
dispatchReplyFromConfig()
  - session store lookup → 找到已有 session
  - 非重复消息 → 继续
  - 非 fast abort → 继续
getReplyFromConfig()
  - 配置加载: alibaba/glm-5.1
  - sessionId = e4205302-...，isNewSession = false
  - 指令解析: 无 inline 指令

### A.3 Bootstrap 注入

resolveBootstrapContextForRun()
  → 发现:
    AGENTS.md ✓ (12,000 chars)  SOUL.md ✓ (1,200)
    TOOLS.md ✓ (3,800)          IDENTITY.md ✓ (200)
    USER.md ✓ (300)             HEARTBEAT.md ✓ (1,500)
    BOOTSTRAP.md ✗ → [MISSING] 注入
    MEMORY.md ✓ (8,000)
  → total = 27,000 chars < 60,000 → 无需截断
  → HEARTBEAT 标记为动态，稍后注入

### A.4 System Prompt 组装

buildAgentSystemPrompt()
  → 稳定部分: AGENTS + SOUL + IDENTITY + USER + TOOLS + MEMORY
  → CACHE_BOUNDARY
  → 动态部分: HEARTBEAT
  → Runtime: model=alibaba/glm-5.1 | thinking=low | channel=webchat
  → 最终 system prompt ≈ 35,000 chars (~8,750 tokens)

### A.5 压缩触发判断

estimatedPromptTokens:
  system prompt: ~8,750 tokens
  历史消息（15条）: ~3,000 tokens
  当前消息: ~10 tokens
  × 1.1 安全余量 ≈ 12,925 tokens

promptBudgetBeforeReserve = 160,000 tokens
overflowTokens = max(0, 12,925 - 160,000) = 0
→ route = "fits"，不触发压缩

### A.6 LLM 请求构建

请求结构:
  system: [完整 system prompt]
  messages: [{ role: "user", content: "帮我查一下杭州天气" }]
  tools: [25 个工具定义]
  thinking: low
  model: alibaba/glm-5.1

### A.7 LLM 响应与 Tool Call

LLM → 感知 weather skill → tool_call: web_fetch(url="wttr.in/杭州?format=j1")
  → wttr.in API 返回天气 JSON（~500 chars，远低于截断阈值）
  → tool_result 注入 session

### A.8 最终响应

LLM 再次调用（带 tool result）→ 生成回复:
  "杭州现在 19°C，小雨，湿度 85%，东南风 2级。"

响应后:
  - session JSONL 追加用户消息 + 助手消息
  - 无 compaction 触发（token 数远未达阈值）
  - 无 post-compaction 刷新

### A.9 完整时序

14:50:00.000  用户发送消息
14:50:00.050  Gateway 接收，创建 InboundContext
14:50:00.100  dispatchReplyFromConfig() 开始
14:50:00.150  getReplyFromConfig() 加载配置
14:50:00.200  initSessionState() 加载 session
14:50:00.300  resolveBootstrapContextForRun() 加载 bootstrap
14:50:00.400  buildAgentSystemPrompt() 组装 system prompt
14:50:00.500  shouldPreemptivelyCompactBeforePrompt() → fits
14:50:00.550  runEmbeddedAttempt() 初始化 Pi Agent
14:50:00.600  发送 LLM 请求（streaming）
14:50:01.200  LLM 返回 tool_call（weather → web_fetch）
14:50:01.250  执行 web_fetch
14:50:01.800  wttr.in API 返回
14:50:01.850  tool_result 注入 session
14:50:02.000  LLM 再次调用（自动）
14:50:02.500  LLM 返回最终文本
14:50:02.550  流式输出到 webchat
14:50:02.600  session JSONL 写入
14:50:02.650  清理，session 标记 idle

## 附录 B: 关键源码文件映射

功能
源码文件
关键函数

消息调度
dispatch-JNo_iJw5.js
dispatchReplyFromConfig()

Reply 配置
get-reply-XW5nFnK2.js
getReplyFromConfig(), runPreparedReply()

嵌入式运行
pi-embedded-runner-DN0VbqlW.js
runEmbeddedAttempt()

System Prompt 组装
system-prompt-D8lixhp6.js
buildAgentSystemPrompt()

Bootstrap 文件
bootstrap-files-ZYTN7n8L.js
resolveBootstrapContextForRun()

工作区扫描
workspace-hhTlRYqM.js
loadWorkspaceBootstrapFiles()

Bootstrap 预算
pi-embedded-helpers-6UMMUO8y.js
buildBootstrapContextFiles()

Skill 加载
skill-loader.ts
loadSkillsForAgent()

Memory 检索
memory-index.ts
memory_search(), memory_get()

压缩触发判断
pi-embedded-runner-DN0VbqlW.js
shouldPreemptivelyCompactBeforePrompt()

压缩安全机制
model-context-tokens-z5hvDVkk.js
compactWithSafetyTimeout()

Safeguard 摘要
compaction-safeguard.ts
summarizeViaLLM(), summarizeWithFallback()

Pi 内置摘要
compaction.js (Pi)
generateSummary()

Tool Result 截断
model-context-tokens-z5hvDVkk.js
truncateToolResultText()

Context Guard
model-context-tokens-z5hvDVkk.js
installToolResultContextGuard()

Post-Compaction
model-context-tokens-z5hvDVkk.js
readPostCompactionContext()

Session 管理
model-context-tokens-z5hvDVkk.js
guardSessionManager()

Post-Compaction 副作用
model-context-tokens-z5hvDVkk.js
runPostCompactionSideEffects()

Memory 同步
post-compaction-context.ts
syncPostCompactionSessionMemory()

常量定义
pi-compaction-constants.ts
MIN_PROMPT_BUDGET_TOKENS, SAFETY_MARGIN

## 附录 C: 你的实际配置快照

{
  "model": {
    "provider": "alibaba",
    "modelId": "glm-5.1",
    "contextWindow": 200000
  },
  "compaction": {
    "mode": "safeguard",
    "reserveTokens": 40000,
    "keepRecentTokens": 20000,
    "notifyUser": true
  },
  "bootstrap": {
    "bootstrapMaxChars": 12000,
    "bootstrapTotalMaxChars": 60000,
    "bootstrapPromptTruncationWarning": "once"
  },
  "contextInjection": "always",
  "thinking": "low",
  "reasoning": "off"
}

## 设计要点总结

**七道防线，层层兜底：**

- **Bootstrap 预算控制** — 文件注入上限（12K/60K chars），避免 system prompt 膨胀

- **System Prompt Stable/Dynamic 分离** — Anthropic cache_control 优化；HEARTBEAT.md 作为唯一动态文件

- **Preemptive Compaction** — LLM 调用前评估，溢出前主动压缩

- **Compaction Safeguard** — 接管 Pi 内置压缩，结构化摘要 + 三级 fallback + identifiers 保护

- **Tool Result 截断** — 运行时单条/总量双限制，三级截断策略

- **Post-Compaction 刷新** — 确保压缩后 agent 不丢失关键启动指令

- **Fallback 链路** — Provider / 摘要 / Memory / Bootstrap / Tool Result / Skill 六层各自兜底

**可扩展性：** 插件 Hook（11个）→ Internal Hook（8个）→ Pi Hook（5个），三层各自独立，层层可介入。

*文档版本 v2026.4.15-final。如需补充任何环节的源码细节，告诉我。*