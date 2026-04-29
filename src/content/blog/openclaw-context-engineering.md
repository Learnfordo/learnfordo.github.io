---
title: 'OpenClaw Context Engineering 完整链路文档'
description: '本文档基于 OpenClaw 源码逆向分析，覆盖从消息到达 Gateway 到最终响应的完整生命周期：主链路、Skills 子系统、Memory 子系统、错误处理、Provider 抽象层、Hook 体系、Fallback 链路等七大模块。'
pubDate: '2026-04-29'
---


<h1 id="openclaw-context-engineering">OpenClaw Context Engineering 完整链路文档</h1>
<blockquote>
<p>版本: v2026.4.15-final | 作者: LuffyUp | 日期: 2026-04-29<br />
本文档基于 OpenClaw 源码逆向分析，覆盖从消息到达 Gateway 到最终响应的完整生命周期。<br />
包含：主链路 + Skills 子系统 + Memory 子系统 + 错误处理 + Provider 抽象层 + Hook 体系 + Fallback 链路</p>
</blockquote>
<hr />
<h2 id="_1">目录</h2>
<ol>
<li><a href="#phase-0-消息到达">Phase 0: 消息到达</a></li>
<li><a href="#phase-1-预处理pre-processing">Phase 1: 预处理（Pre-processing）</a></li>
<li><a href="#phase-2-system-prompt-组装">Phase 2: System Prompt 组装</a></li>
<li><a href="#phase-3-压缩触发判断preemptive-compaction">Phase 3: 压缩触发判断（Preemptive Compaction）</a></li>
<li><a href="#phase-4-llm-请求构建与调用">Phase 4: LLM 请求构建与调用</a></li>
<li><a href="#phase-5-tool-loopreact-循环">Phase 5: Tool Loop（ReAct 循环）</a></li>
<li><a href="#phase-6-后处理post-processing">Phase 6: 后处理（Post-processing）</a></li>
<li><a href="#skills-子系统">Skills 子系统</a></li>
<li><a href="#memory-子系统">Memory 子系统</a></li>
<li><a href="#错误处理路径">错误处理路径</a></li>
<li><a href="#provider-抽象层">Provider 抽象层</a></li>
<li><a href="#完整-hook-体系">完整 Hook 体系</a></li>
<li><a href="#fallback-链路详解">Fallback 链路详解</a></li>
<li><a href="#附录-a-完整实例帮我查一下杭州天气">附录 A: 完整实例——&ldquo;帮我查一下杭州天气&rdquo;</a></li>
<li><a href="#附录-b-关键源码文件映射">附录 B: 关键源码文件映射</a></li>
<li><a href="#附录-c-你的实际配置快照">附录 C: 你的实际配置快照</a></li>
<li><a href="#设计要点总结">设计要点总结</a></li>
</ol>
<hr />
<h2 id="phase-0">Phase 0: 消息到达</h2>
<h3 id="01">0.1 消息流转路径</h3>
<div class="codehilite"><pre><span></span><code>用户发送消息
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
</code></pre></div>

<h3 id="02">0.2 核心入口函数</h3>
<p><strong><code>dispatchReplyFromConfig</code></strong> (dispatch-JNo_iJw5.js:237)</p>
<p>这是所有入站消息的通用入口。无论消息来自 webchat、Discord、Telegram 还是其他渠道，最终都走这里。</p>
<p>关键步骤：<br />
1. <strong>Inbound deduplication</strong> — 检查重复消息（同一 MessageSid 30秒内只处理一次）<br />
2. <strong>Session store lookup</strong> — 根据 SessionKey 找到 session 文件路径<br />
3. <strong>Plugin binding check</strong> — 检查是否有插件绑定了这个 conversation（如插件托管模式）<br />
4. <strong>Fast abort</strong> — 如果是 <code>/stop</code> 命令，立即终止子代理<br />
5. <strong>Hook trigger</strong> — 触发 <code>message_received</code> 插件 hook<br />
6. <strong>进入 getReplyFromConfig</strong></p>
<h3 id="03">0.3 你的实际配置</h3>
<div class="codehilite"><pre><span></span><code><span class="p">{</span>
<span class="w">  </span><span class="nt">&quot;channel&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;webchat&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;sessionKey&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;e4205302-4b21-439e-805e-208cd0df6647&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;agentId&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;main&quot;</span>
<span class="p">}</span>
</code></pre></div>

<hr />
<h2 id="phase-1-pre-processing">Phase 1: 预处理（Pre-processing）</h2>
<h3 id="11">1.1 配置加载与模型解析</h3>
<p><strong><code>getReplyFromConfig</code></strong> (get-reply-XW5nFnK2.js:3189)</p>
<div class="codehilite"><pre><span></span><code><span class="mf">1.</span><span class="w"> </span><span class="n">加载</span><span class="w"> </span><span class="kr">open</span><span class="n">claw</span><span class="mf">.</span><span class="n">json</span><span class="w"> </span><span class="n">配置</span>
<span class="mf">2.</span><span class="w"> </span><span class="n">解析默认模型</span><span class="p">:</span><span class="w"> </span><span class="n">provider</span><span class="o">=</span><span class="s">&quot;alibaba&quot;</span><span class="p">,</span><span class="w"> </span><span class="n">modelId</span><span class="o">=</span><span class="s">&quot;glm-5.1&quot;</span>
<span class="mf">3.</span><span class="w"> </span><span class="n">检查心跳模型覆盖</span><span class="err">（</span><span class="n">heartbeat</span><span class="mf">.</span><span class="n">model</span><span class="err">）</span>
<span class="mf">4.</span><span class="w"> </span><span class="n">检查</span><span class="w"> </span><span class="n">session</span><span class="w"> </span><span class="n">存储的模型覆盖</span><span class="err">（</span><span class="n">sessionEntry</span><span class="mf">.</span><span class="n">modelOverride</span><span class="err">）</span>
<span class="mf">5.</span><span class="w"> </span><span class="n">检查渠道模型覆盖</span><span class="err">（</span><span class="n">channel</span><span class="w"> </span><span class="n">model</span><span class="w"> </span><span class="n">override</span><span class="err">）</span>
<span class="mf">6.</span><span class="w"> </span><span class="n">最终确定</span><span class="w"> </span><span class="n">provider</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="n">model</span>
</code></pre></div>

<h3 id="12-session">1.2 Session 状态初始化</h3>
<p><strong><code>initSessionState</code></strong> → <code>useFastTestBootstrap ? initFastReplySessionState : await initSessionState</code></p>
<p>初始化以下状态：<br />
- <code>sessionKey</code> — 当前会话标识<br />
- <code>sessionId</code> — Pi 内部 session ID（UUID）<br />
- <code>sessionEntry</code> — session store 中的持久化状态<br />
- <code>sessionFile</code> — JSONL 文件路径<br />
- <code>isNewSession</code> — 是否是新会话<br />
- <code>resetTriggered</code> — 是否触发了 /reset</p>
<h3 id="13">1.3 指令解析</h3>
<p><strong><code>resolveReplyDirectives</code></strong> — 解析用户消息中的 inline 指令：</p>
<table>
<thead>
<tr>
<th>指令</th>
<th>效果</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>/think high</code></td>
<td>切换 thinking level</td>
</tr>
<tr>
<td><code>/reasoning on</code></td>
<td>开启 reasoning</td>
</tr>
<tr>
<td><code>/verbose</code></td>
<td>开启 verbose 输出</td>
</tr>
<tr>
<td><code>/model alibaba/glm-5.1</code></td>
<td>切换模型</td>
</tr>
<tr>
<td><code>/new</code> or <code>/reset</code></td>
<td>重置会话</td>
</tr>
</tbody>
</table>
<h3 id="14-bootstrap">1.4 Bootstrap 上下文注入</h3>
<p>这是整个 context engineering 的第一道防线。</p>
<p><strong><code>resolveBootstrapContextForRun</code></strong> (bootstrap-files-ZYTN7n8L.js)</p>
<h4 id="141-bootstrap">1.4.1 Bootstrap 文件加载顺序</h4>
<div class="codehilite"><pre><span></span><code><span class="n">loadWorkspaceBootstrapFiles</span><span class="p">(</span><span class="n">workspaceDir</span><span class="p">)</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="err">按固定顺序扫描</span><span class="p">:</span>
<span class="w">    </span><span class="mf">1.</span><span class="w"> </span><span class="n">AGENTS</span><span class="o">.</span><span class="n">md</span><span class="w">      </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">10</span><span class="p">)</span>
<span class="w">    </span><span class="mf">2.</span><span class="w"> </span><span class="n">SOUL</span><span class="o">.</span><span class="n">md</span><span class="w">        </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">20</span><span class="p">)</span>
<span class="w">    </span><span class="mf">3.</span><span class="w"> </span><span class="n">TOOLS</span><span class="o">.</span><span class="n">md</span><span class="w">       </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">50</span><span class="p">)</span>
<span class="w">    </span><span class="mf">4.</span><span class="w"> </span><span class="n">IDENTITY</span><span class="o">.</span><span class="n">md</span><span class="w">    </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">30</span><span class="p">)</span>
<span class="w">    </span><span class="mf">5.</span><span class="w"> </span><span class="n">USER</span><span class="o">.</span><span class="n">md</span><span class="w">        </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">40</span><span class="p">)</span>
<span class="w">    </span><span class="mf">6.</span><span class="w"> </span><span class="n">HEARTBEAT</span><span class="o">.</span><span class="n">md</span><span class="w">   </span><span class="p">(</span><span class="n">dynamic</span><span class="p">,</span><span class="w"> </span><span class="n">order</span><span class="o">=</span><span class="n">MAX</span><span class="p">)</span>
<span class="w">    </span><span class="mf">7.</span><span class="w"> </span><span class="n">BOOTSTRAP</span><span class="o">.</span><span class="n">md</span><span class="w">   </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">60</span><span class="p">)</span>
<span class="w">    </span><span class="mf">8.</span><span class="w"> </span><span class="n">MEMORY</span><span class="o">.</span><span class="n">md</span><span class="w">      </span><span class="p">(</span><span class="n">order</span><span class="o">=</span><span class="mi">70</span><span class="p">,</span><span class="w"> </span><span class="err">或</span><span class="w"> </span><span class="n">memory</span><span class="o">.</span><span class="n">md</span><span class="p">)</span>
</code></pre></div>

<p><strong>关键行为：</strong><br />
- 文件不存在 → 注入 <code>[MISSING] Expected at: &lt;path&gt;</code><br />
- 文件读取失败（权限/文件锁）→ 同&rdquo;不存在&rdquo;，注入 <code>[MISSING]</code><br />
- 文件存在但为空 → 注入空内容（不注入 <code>[MISSING]</code>，LLM 感知文件存在）<br />
- HEARTBEAT.md 不存在 → 不注入 <code>[MISSING]</code>，改为注入默认心跳提示词<br />
- 子代理/Cron session → 只加载最小集合 (AGENTS, TOOLS, SOUL, IDENTITY, USER)<br />
- 非默认 agent → 不加载 HEARTBEAT.md<br />
- lightweight mode → 只保留 HEARTBEAT.md</p>
<h4 id="142">1.4.2 预算截断</h4>
<p><strong><code>buildBootstrapContextFiles</code></strong> (pi-embedded-helpers-6UMMUO8y.js:130)</p>
<div class="codehilite"><pre><span></span><code>per-file limit:  maxChars      = 12,000 chars（默认）
total limit:     totalMaxChars = 60,000 chars（默认）
min budget:      MIN_BOOTSTRAP_FILE_BUDGET_CHARS = 256
head ratio:      BOOTSTRAP_HEAD_RATIO = 0.6
tail ratio:      BOOTSTRAP_TAIL_RATIO = 0.4
</code></pre></div>

<p>截断策略：<br />
1. 超出 <code>maxChars</code> → 头尾保留（60%头 + 40%尾），中间插入 <code>[...truncated...]</code><br />
2. 超出 <code>totalMaxChars</code> → 整文件被截断到剩余预算内<br />
3. 剩余预算 &lt; 256 → 跳过后续文件</p>
<p><strong>你的配置：</strong></p>
<div class="codehilite"><pre><span></span><code><span class="p">{</span>
<span class="w">  </span><span class="nt">&quot;bootstrapMaxChars&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">12000</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;bootstrapTotalMaxChars&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">60000</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;bootstrapPromptTruncationWarning&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;once&quot;</span>
<span class="p">}</span>
</code></pre></div>

<h4 id="143-bootstrap-hook">1.4.3 Bootstrap Hook</h4>
<p><code>applyBootstrapHookOverrides</code> — 允许插件通过 <code>agent:bootstrap</code> internal hook 修改 bootstrap files 列表。</p>
<h3 id="15">1.5 心跳提示词注入</h3>
<p><strong><code>resolveHeartbeatPromptForSystemPrompt</code></strong> (bootstrap-files-ZYTN7n8L.js)</p>
<p>条件：<br />
- 当前 agent 是默认 agent<br />
- heartbeat 配置中 <code>includeSystemPromptSection !== false</code><br />
- heartbeat cadence &gt; 0（默认 30m）</p>
<p>注入内容：读取 <code>HEARTBEAT.md</code> 文件内容（如果存在），否则注入默认提示：</p>
<div class="codehilite"><pre><span></span><code>Read HEARTBEAT.md if it exists (workspace context). Follow it strictly.
Do not infer or repeat old tasks from prior chats.
If nothing needs attention, reply HEARTBEAT_OK.
</code></pre></div>

<hr />
<h2 id="phase-2-system-prompt">Phase 2: System Prompt 组装</h2>
<p>这是 context engineering 最核心的环节。所有指令、工具说明、上下文文件都在这里拼接。</p>
<h3 id="21">2.1 调用链</h3>
<div class="codehilite"><pre><span></span><code>runEmbeddedAttempt()
  → buildEmbeddedSystemPrompt(params)
    → buildAgentSystemPrompt(params)
      → 拼接所有 sections
</code></pre></div>

<h3 id="22">2.2 完整拼接顺序</h3>
<p><code>buildAgentSystemPrompt</code> (system-prompt-D8lixhp6.js:260) 的输出按以下顺序拼接：</p>
<div class="codehilite"><pre><span></span><code><span class="p">[</span><span class="mi">1</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;You are a personal assistant running inside OpenClaw.&quot;</span>

<span class="p">[</span><span class="mi">2</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;## Tooling&quot;</span>
<span class="w">      </span><span class="n">工具列表</span><span class="err">（</span><span class="n">按固定顺序</span><span class="err">，</span><span class="mi">25</span><span class="n">个</span><span class="err">）</span>
<span class="w">      </span><span class="s">&quot;TOOLS.md does not control tool availability...&quot;</span>
<span class="w">      </span><span class="s">&quot;For long waits, avoid rapid poll loops...&quot;</span>
<span class="w">      </span><span class="p">[</span><span class="n">ACP</span><span class="w"> </span><span class="n">harness</span><span class="w"> </span><span class="n">instructions</span><span class="w"> </span><span class="k">if</span><span class="w"> </span><span class="n">enabled</span><span class="p">]</span>

<span class="p">[</span><span class="mi">3</span><span class="p">]</span><span class="w">  </span><span class="p">[</span><span class="n">provider</span><span class="w"> </span><span class="n">override</span><span class="o">:</span><span class="w"> </span><span class="n">interaction_style</span><span class="p">]</span>

<span class="p">[</span><span class="mi">4</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;## Tool Call Style&quot;</span>
<span class="w">      </span><span class="n">工具调用风格指南</span>

<span class="p">[</span><span class="mi">5</span><span class="p">]</span><span class="w">  </span><span class="p">[</span><span class="n">provider</span><span class="w"> </span><span class="n">override</span><span class="o">:</span><span class="w"> </span><span class="n">execution_bias</span><span class="p">]</span>

<span class="p">[</span><span class="mi">6</span><span class="p">]</span><span class="w">  </span><span class="p">[</span><span class="n">provider</span><span class="w"> </span><span class="n">stable</span><span class="w"> </span><span class="n">prefix</span><span class="p">]</span>

<span class="p">[</span><span class="mi">7</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;## Safety&quot;</span>
<span class="w">      </span><span class="s">&quot;You have no independent goals...&quot;</span>

<span class="p">[</span><span class="mi">8</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;## OpenClaw CLI Quick Reference&quot;</span>

<span class="p">[</span><span class="mi">9</span><span class="p">]</span><span class="w">  </span><span class="s">&quot;## Skills (mandatory)&quot;</span>
<span class="w">      </span><span class="n">Before</span><span class="w"> </span><span class="n">replying</span><span class="o">:</span><span class="w"> </span><span class="n">scan</span><span class="w"> </span><span class="o">&lt;</span><span class="n">available_skills</span><span class="o">&gt;</span><span class="p">...</span>
<span class="w">      </span><span class="o">&lt;</span><span class="n">available_skills</span><span class="o">&gt;</span>
<span class="w">        </span><span class="p">[</span><span class="n">skill</span><span class="w"> </span><span class="n">列表</span><span class="err">，</span><span class="n">含名称</span><span class="err">、</span><span class="n">描述</span><span class="err">、</span><span class="n">requires</span><span class="p">]</span>
<span class="w">      </span><span class="o">&lt;/</span><span class="n">available_skills</span><span class="o">&gt;</span>

<span class="p">[</span><span class="mi">10</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## 🧠 MEMORY.md / 📝 Write It Down&quot;</span>
<span class="w">      </span><span class="n">memory_search</span><span class="w"> </span><span class="o">/</span><span class="w"> </span><span class="n">memory_get</span><span class="w"> </span><span class="n">使用规则</span>
<span class="w">      </span><span class="n">写入时机指引</span>

<span class="p">[</span><span class="mi">11</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## OpenClaw Self-Update&quot;</span><span class="err">（</span><span class="n">如果有</span><span class="w"> </span><span class="n">gateway</span><span class="w"> </span><span class="n">工具</span><span class="err">）</span>

<span class="p">[</span><span class="mi">12</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Model Aliases&quot;</span><span class="err">（</span><span class="n">如果有别名</span><span class="err">）</span>

<span class="p">[</span><span class="mi">13</span><span class="p">]</span><span class="w"> </span><span class="p">[</span><span class="n">timezone</span><span class="w"> </span><span class="n">hint</span><span class="p">]</span>
<span class="w">      </span><span class="s">&quot;## Workspace&quot;</span>
<span class="w">      </span><span class="s">&quot;Your working directory is: /Users/.../.openclaw/workspace&quot;</span>

<span class="p">[</span><span class="mi">14</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Documentation&quot;</span>

<span class="p">[</span><span class="mi">15</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Sandbox&quot;</span><span class="err">（</span><span class="n">如果</span><span class="w"> </span><span class="n">sandbox</span><span class="w"> </span><span class="n">启用</span><span class="err">）</span>

<span class="p">[</span><span class="mi">16</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Authorized Senders&quot;</span><span class="err">（</span><span class="n">如果有</span><span class="w"> </span><span class="n">ownerNumbers</span><span class="err">）</span>

<span class="p">[</span><span class="mi">17</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Current Date &amp; Time&quot;</span><span class="err">（</span><span class="n">如果有</span><span class="w"> </span><span class="n">timezone</span><span class="err">）</span>

<span class="p">[</span><span class="mi">18</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Workspace Files (injected)&quot;</span>

<span class="p">[</span><span class="mi">19</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Assistant Output Directives&quot;</span>
<span class="w">      </span><span class="nl">MEDIA</span><span class="p">:,</span><span class="w"> </span><span class="p">[[</span><span class="n">audio_as_voice</span><span class="p">]],</span><span class="w"> </span><span class="p">[[</span><span class="n">reply_to_current</span><span class="p">]]</span><span class="w"> </span><span class="n">等</span>

<span class="p">[</span><span class="mi">20</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Control UI Embed&quot;</span><span class="err">（</span><span class="n">webchat</span><span class="w"> </span><span class="n">专用</span><span class="err">）</span>

<span class="p">[</span><span class="mi">21</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Messaging&quot;</span>

<span class="p">[</span><span class="mi">22</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Voice (TTS)&quot;</span><span class="err">（</span><span class="n">如果有</span><span class="w"> </span><span class="n">TTS</span><span class="w"> </span><span class="n">hint</span><span class="err">）</span>

<span class="p">[</span><span class="mi">23</span><span class="p">]</span><span class="w"> </span><span class="p">[</span><span class="n">Reactions</span><span class="w"> </span><span class="n">guidance</span><span class="p">]</span><span class="err">（</span><span class="n">如果启用</span><span class="err">）</span>

<span class="p">[</span><span class="mi">24</span><span class="p">]</span><span class="w"> </span><span class="p">[</span><span class="n">Reasoning</span><span class="w"> </span><span class="n">Format</span><span class="p">]</span><span class="err">（</span><span class="n">如果</span><span class="w"> </span><span class="n">reasoningTagHint</span><span class="err">）</span>
<span class="w">      </span><span class="n">强制使用</span><span class="w"> </span><span class="o">&lt;</span><span class="n">thinking</span><span class="o">&gt;</span><span class="p">...</span><span class="o">&lt;/</span><span class="n">thinking</span><span class="o">&gt;</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="o">&lt;</span><span class="n">final</span><span class="o">&gt;</span><span class="p">...</span><span class="o">&lt;/</span><span class="n">final</span><span class="o">&gt;</span>

<span class="o">---</span><span class="w"> </span><span class="n">SYSTEM_PROMPT_CACHE_BOUNDARY</span><span class="w"> </span><span class="o">---</span>
<span class="w">     </span><span class="err">（</span><span class="n">Anthropic</span><span class="w"> </span><span class="n">cache_control</span><span class="w"> </span><span class="n">分界线</span><span class="err">；</span><span class="n">alibaba</span><span class="w"> </span><span class="n">provider</span><span class="w"> </span><span class="n">下作为普通文本出现</span><span class="err">）</span>

<span class="p">[</span><span class="mi">25</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;# Project Context&quot;</span><span class="err">（</span><span class="n">稳定上下文文件</span><span class="err">）</span>
<span class="w">      </span><span class="n">AGENTS</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">SOUL</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">IDENTITY</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">USER</span><span class="p">.</span><span class="n">md</span>
<span class="w">      </span><span class="err">→</span><span class="w"> </span><span class="n">TOOLS</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">BOOTSTRAP</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">MEMORY</span><span class="p">.</span><span class="n">md</span>
<span class="w">      </span><span class="err">（</span><span class="n">按</span><span class="w"> </span><span class="n">CONTEXT_FILE_ORDER</span><span class="w"> </span><span class="n">排序</span><span class="err">）</span>

<span class="p">[</span><span class="mi">26</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Silent Replies&quot;</span>
<span class="w">      </span><span class="s">&quot;When you have nothing to say, respond with ONLY: NO_REPLY&quot;</span>

<span class="p">[</span><span class="mi">27</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;&lt;!-- OPENCLAW_CACHE_BOUNDARY --&gt;&quot;</span>

<span class="p">[</span><span class="mi">28</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;# Dynamic Project Context&quot;</span>
<span class="w">      </span><span class="n">HEARTBEAT</span><span class="p">.</span><span class="n">md</span><span class="err">（</span><span class="n">唯一动态文件</span><span class="err">）</span>

<span class="p">[</span><span class="mi">29</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Group Chat Context&quot;</span><span class="w"> </span><span class="o">/</span><span class="w"> </span><span class="s">&quot;## Subagent Context&quot;</span>
<span class="w">      </span><span class="p">[</span><span class="n">extraSystemPrompt</span><span class="w"> </span><span class="k">if</span><span class="w"> </span><span class="n">any</span><span class="p">]</span>

<span class="p">[</span><span class="mi">30</span><span class="p">]</span><span class="w"> </span><span class="p">[</span><span class="n">provider</span><span class="w"> </span><span class="n">dynamic</span><span class="w"> </span><span class="n">suffix</span><span class="p">]</span>

<span class="p">[</span><span class="mi">31</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Heartbeats&quot;</span>
<span class="w">      </span><span class="p">[</span><span class="n">heartbeatPrompt</span><span class="w"> </span><span class="n">content</span><span class="p">]</span>

<span class="p">[</span><span class="mi">32</span><span class="p">]</span><span class="w"> </span><span class="s">&quot;## Runtime&quot;</span>
<span class="w">      </span><span class="s">&quot;Runtime: agent=main | host=... | model=alibaba/glm-5.1&quot;</span>
<span class="w">      </span><span class="s">&quot;channel=webchat | capabilities=none | thinking=low&quot;</span>
<span class="w">      </span><span class="s">&quot;Reasoning: off (hidden unless on/stream)...&quot;</span>
</code></pre></div>

<h3 id="23">2.3 关键设计</h3>
<p><strong>Stable vs Dynamic 分离：</strong><br />
- <code>SYSTEM_PROMPT_CACHE_BOUNDARY</code> 之前 → Anthropic cache_control 缓存（prefix）<br />
- <code>SYSTEM_PROMPT_CACHE_BOUNDARY</code> 之后 → 每轮可能变化（suffix）<br />
- <code>OPENCLAW_CACHE_BOUNDARY</code> → 标记 Project Context 结束</p>
<p><strong>Context File Order：</strong></p>
<div class="codehilite"><pre><span></span><code><span class="kd">const</span><span class="w"> </span><span class="nx">CONTEXT_FILE_ORDER</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="ow">new</span><span class="w"> </span><span class="nb">Map</span><span class="p">([</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;agents.md&quot;</span><span class="p">,</span><span class="w">    </span><span class="mf">10</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;soul.md&quot;</span><span class="p">,</span><span class="w">      </span><span class="mf">20</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;identity.md&quot;</span><span class="p">,</span><span class="w">  </span><span class="mf">30</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;user.md&quot;</span><span class="p">,</span><span class="w">      </span><span class="mf">40</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;tools.md&quot;</span><span class="p">,</span><span class="w">     </span><span class="mf">50</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;bootstrap.md&quot;</span><span class="p">,</span><span class="w"> </span><span class="mf">60</span><span class="p">],</span>
<span class="w">  </span><span class="p">[</span><span class="s2">&quot;memory.md&quot;</span><span class="p">,</span><span class="w">    </span><span class="mf">70</span><span class="p">]</span>
<span class="p">]);</span>
</code></pre></div>

<p><strong>动态文件：</strong><br />
- <code>DYNAMIC_CONTEXT_FILE_BASENAMES = {"heartbeat.md"}</code> — 唯一标记为动态的文件<br />
- 动态文件放在 <code>OPENCLAW_CACHE_BOUNDARY</code> 之后，确保不被缓存</p>
<hr />
<h2 id="phase-3-preemptive-compaction">Phase 3: 压缩触发判断（Preemptive Compaction）</h2>
<p>在发送 LLM 请求之前，OpenClaw 会评估当前上下文是否会溢出。</p>
<h3 id="31">3.1 触发条件</h3>
<p><strong><code>shouldPreemptivelyCompactBeforePrompt</code></strong> (pi-embedded-runner-DN0VbqlW.js:5400)</p>
<div class="codehilite"><pre><span></span><code>输入:
  <span class="k">-</span> messages: 当前 session 中的所有消息（含 system prompt）
  <span class="k">-</span> systemPrompt: 刚组装的系统提示
  <span class="k">-</span> prompt: 当前用户消息
  <span class="k">-</span> contextTokenBudget: 模型 context window（默认 200,000）
  <span class="k">-</span> reserveTokens: 40,000（你的配置）

计算:
  1. estimatedPromptTokens = estimateMessagesTokens(messages)
     + estimateTokens(systemPrompt) + estimateTokens(prompt)
     （estimateMessagesTokens 对每条消息取 JSON.stringify 后 / 4）
  2. estimatedPromptTokens <span class="gs">*= SAFETY_MARGIN (1.1)   ← 10% 安全余量</span>
<span class="gs">  3. minPromptBudget = min(8000, contextWindow *</span> 0.5)
  4. effectiveReserve = min(reserveTokens, contextWindow - minPromptBudget)
  5. promptBudgetBeforeReserve = contextWindow - effectiveReserve
  6. overflowTokens = max(0, estimatedPromptTokens - promptBudgetBeforeReserve)
</code></pre></div>

<h3 id="32">3.2 决策路线</h3>
<div class="codehilite"><pre><span></span><code><span class="n">overflowTokens</span><span class="w"> </span><span class="o">&gt;</span><span class="w"> </span><span class="mi">0</span><span class="err">?</span>
<span class="w">  </span><span class="err">│</span>
<span class="w">  </span><span class="err">├─</span><span class="w"> </span><span class="n">No</span><span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">route</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="s2">&quot;fits&quot;</span><span class="err">，直接进入</span><span class="w"> </span><span class="n">Phase</span><span class="w"> </span><span class="mi">4</span>
<span class="w">  </span><span class="err">│</span>
<span class="w">  </span><span class="err">└─</span><span class="w"> </span><span class="n">Yes</span>
<span class="w">       </span><span class="err">│</span>
<span class="w">       </span><span class="err">├─</span><span class="w"> </span><span class="n">toolResultReducibleChars</span><span class="w"> </span><span class="o">&lt;=</span><span class="w"> </span><span class="mi">0</span>
<span class="w">       </span><span class="err">│</span><span class="w">    </span><span class="err">→</span><span class="w"> </span><span class="s2">&quot;compact_only&quot;</span><span class="err">（无可截断工具结果，只能压缩）</span>
<span class="w">       </span><span class="err">│</span>
<span class="w">       </span><span class="err">└─</span><span class="w"> </span><span class="n">toolResultReducibleChars</span><span class="w"> </span><span class="o">&gt;</span><span class="w"> </span><span class="mi">0</span>
<span class="w">            </span><span class="err">│</span>
<span class="w">            </span><span class="err">├─</span><span class="w"> </span><span class="err">截断能完全消化溢出</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="s2">&quot;truncate_tool_results_only&quot;</span>
<span class="w">            </span><span class="err">│</span>
<span class="w">            </span><span class="err">└─</span><span class="w"> </span><span class="err">截断不足以消化溢出</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="s2">&quot;compact_then_truncate&quot;</span>
</code></pre></div>

<h3 id="33">3.3 你的实际场景</h3>
<div class="codehilite"><pre><span></span><code><span class="err">模型</span><span class="o">:</span><span class="w">  </span><span class="n">alibaba</span><span class="o">/</span><span class="n">glm</span><span class="o">-</span><span class="mf">5.1</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">context</span><span class="w"> </span><span class="n">window</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">200</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span>
<span class="err">配置</span><span class="o">:</span><span class="w">  </span><span class="n">reserveTokens</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">40</span><span class="o">,</span><span class="mi">000</span>
<span class="err">计算</span><span class="o">:</span>
<span class="w">  </span><span class="n">promptBudgetBeforeReserve</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">200</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="o">-</span><span class="w"> </span><span class="mi">40</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">160</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span>
<span class="w">  </span><span class="n">minPromptBudget</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="n">min</span><span class="o">(</span><span class="mi">8</span><span class="o">,</span><span class="mi">000</span><span class="o">,</span><span class="w"> </span><span class="mi">100</span><span class="o">,</span><span class="mi">000</span><span class="o">)</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">8</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span>

<span class="err">典型</span><span class="w"> </span><span class="n">session</span><span class="err">（</span><span class="n">system</span><span class="w"> </span><span class="n">prompt</span><span class="w"> </span><span class="o">~</span><span class="mi">8</span><span class="o">,</span><span class="mi">750</span><span class="w"> </span><span class="n">tokens</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="mi">15</span><span class="err">条历史</span><span class="w"> </span><span class="o">~</span><span class="mi">3</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span><span class="err">）</span><span class="o">:</span>
<span class="w">  </span><span class="n">estimatedPromptTokens</span><span class="w"> </span><span class="err">≈</span><span class="w"> </span><span class="o">(</span><span class="mi">8</span><span class="o">,</span><span class="mi">750</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="mi">3</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="mi">10</span><span class="o">)</span><span class="w"> </span><span class="err">×</span><span class="w"> </span><span class="mf">1.1</span><span class="w"> </span><span class="err">≈</span><span class="w"> </span><span class="mi">12</span><span class="o">,</span><span class="mi">925</span><span class="w"> </span><span class="n">tokens</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="err">远低于</span><span class="w"> </span><span class="mi">160</span><span class="o">,</span><span class="mi">000</span><span class="err">，不触发压缩</span>
</code></pre></div>

<hr />
<h2 id="phase-4-llm">Phase 4: LLM 请求构建与调用</h2>
<h3 id="41">4.1 请求组装</h3>
<div class="codehilite"><pre><span></span><code>runEmbeddedAttempt()
  → prepareCompactionSessionAgent()
    → resolveEmbeddedAgentStreamFn()
      → resolveProviderStreamFn()
        → 最终调用 provider 的 streaming API
</code></pre></div>

<h3 id="42-pi-session">4.2 Pi Session 初始化</h3>
<p><strong><code>runEmbeddedAttempt</code></strong> (pi-embedded-runner-DN0VbqlW.js:5501)</p>
<div class="codehilite"><pre><span></span><code><span class="mf">1.</span><span class="w"> </span><span class="n">创建工作区目录</span>
<span class="mf">2.</span><span class="w"> </span><span class="n">解析沙箱配置</span>
<span class="mf">3.</span><span class="w"> </span><span class="n">加载技能</span><span class="err">（</span><span class="n">skills</span><span class="err">）</span>
<span class="mf">4.</span><span class="w"> </span><span class="n">解析</span><span class="w"> </span><span class="n">bootstrap</span><span class="w"> </span><span class="n">上下文</span>
<span class="mf">5.</span><span class="w"> </span><span class="n">构建</span><span class="w"> </span><span class="kr">sys</span><span class="n">tem</span><span class="w"> </span><span class="n">prompt</span>
<span class="mf">6.</span><span class="w"> </span><span class="n">初始化</span><span class="w"> </span><span class="n">Pi</span><span class="w"> </span><span class="n">Agent</span>
<span class="mf">7.</span><span class="w"> </span><span class="n">设置</span><span class="w"> </span><span class="n">compaction</span><span class="w"> </span><span class="n">safeguard</span><span class="w"> </span><span class="kr">run</span><span class="n">time</span>
<span class="mf">8.</span><span class="w"> </span><span class="n">设置</span><span class="w"> </span><span class="kr">to</span><span class="n">ol</span><span class="w"> </span><span class="n">result</span><span class="w"> </span><span class="kr">cont</span><span class="n">ext</span><span class="w"> </span><span class="n">guard</span>
<span class="mf">9.</span><span class="w"> </span><span class="n">设置</span><span class="w"> </span><span class="kr">cont</span><span class="n">ext</span><span class="w"> </span><span class="n">pruning</span><span class="err">（</span><span class="n">cache</span><span class="o">-</span><span class="n">ttl</span><span class="w"> </span><span class="n">模式</span><span class="err">，</span><span class="n">仅</span><span class="w"> </span><span class="n">Anthropic</span><span class="err">）</span>
<span class="mf">10.</span><span class="w"> </span><span class="n">运行</span><span class="w"> </span><span class="n">agent</span>
</code></pre></div>

<h3 id="43-compaction-safeguard-runtime">4.3 Compaction Safeguard Runtime</h3>
<p><strong><code>setCompactionSafeguardRuntime</code></strong> (pi-hooks/compaction-safeguard-runtime.ts)</p>
<div class="codehilite"><pre><span></span><code><span class="p">{</span>
<span class="w">  </span><span class="nx">maxHistoryShare</span><span class="o">:</span><span class="w"> </span><span class="mf">0.5</span><span class="p">,</span><span class="w">         </span><span class="c1">// 历史消息最多占 50% context window</span>
<span class="w">  </span><span class="nx">contextWindowTokens</span><span class="o">:</span><span class="w"> </span><span class="mf">200000</span><span class="p">,</span>
<span class="w">  </span><span class="nx">identifierPolicy</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;strict&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nx">qualityGuardEnabled</span><span class="o">:</span><span class="w"> </span><span class="kc">true</span><span class="p">,</span>
<span class="w">  </span><span class="nx">qualityGuardMaxRetries</span><span class="o">:</span><span class="w"> </span><span class="mf">2</span><span class="p">,</span>
<span class="w">  </span><span class="nx">model</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;alibaba/glm-5.1&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nx">recentTurnsPreserve</span><span class="o">:</span><span class="w"> </span><span class="mf">3</span><span class="p">,</span><span class="w">       </span><span class="c1">// 保留最近 3 轮</span>
<span class="w">  </span><span class="nx">provider</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;alibaba&quot;</span>
<span class="p">}</span>
</code></pre></div>

<h3 id="44-tool-result-context-guard">4.4 Tool Result Context Guard</h3>
<p><strong><code>installToolResultContextGuard</code></strong> (model-context-tokens-z5hvDVkk.js:2698)</p>
<div class="codehilite"><pre><span></span><code><span class="p">{</span>
<span class="w">  </span><span class="nx">maxContextChars</span><span class="o">:</span><span class="w">          </span><span class="nx">contextWindow</span><span class="w"> </span><span class="o">*</span><span class="w"> </span><span class="mf">4</span><span class="w"> </span><span class="o">*</span><span class="w"> </span><span class="mf">0.5</span><span class="p">,</span><span class="w">   </span><span class="c1">// ~400,000 chars</span>
<span class="w">  </span><span class="nx">maxSingleToolResultChars</span><span class="o">:</span><span class="w"> </span><span class="nx">contextWindow</span><span class="w"> </span><span class="o">*</span><span class="w"> </span><span class="mf">4</span><span class="w"> </span><span class="o">*</span><span class="w"> </span><span class="mf">0.3</span><span class="w">    </span><span class="c1">// ~240,000 chars</span>
<span class="p">}</span>
</code></pre></div>

<p>拦截逻辑：<br />
1. 在 Pi 的 <code>transformContext</code> hook 中拦截<br />
2. 单条 tool result 超过 <code>maxSingleToolResultChars</code> → 截断，插入 <code>[TOOL RESULT TRUNCATED]</code><br />
3. 总体超过 <code>maxContextChars</code> → 抛出 <code>PREEMPTIVE_CONTEXT_OVERFLOW</code></p>
<h3 id="45-context-pruninganthropic">4.5 Context Pruning（Anthropic 专属）</h3>
<p>你的 provider (alibaba) 不支持 cache-ttl，此步骤跳过。</p>
<hr />
<h2 id="phase-5-tool-loopreact">Phase 5: Tool Loop（ReAct 循环）</h2>
<h3 id="51">5.1 标准循环</h3>
<div class="codehilite"><pre><span></span><code><span class="err">用户消息</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">LLM</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">tool_call</span><span class="err">?</span>
<span class="w">                    </span><span class="err">│</span>
<span class="w">              </span><span class="n">Yes</span><span class="w"> </span><span class="err">──┤</span>
<span class="w">                    </span><span class="err">↓</span>
<span class="w">               </span><span class="err">执行</span><span class="w"> </span><span class="k">tool</span>
<span class="w">                    </span><span class="err">↓</span>
<span class="w">              </span><span class="n">tool_result</span><span class="w"> </span><span class="err">注入</span><span class="w"> </span><span class="n">session</span>
<span class="w">                    </span><span class="err">↓</span>
<span class="w">              </span><span class="n">LLM</span><span class="w"> </span><span class="err">再次调用</span>
<span class="w">                    </span><span class="err">↓</span>
<span class="w">              </span><span class="o">...</span><span class="err">循环直到无</span><span class="w"> </span><span class="n">tool_call</span>
<span class="w">                    </span><span class="err">│</span>
<span class="w">              </span><span class="n">No</span><span class="w"> </span><span class="err">───┤</span>
<span class="w">                    </span><span class="err">↓</span>
<span class="w">               </span><span class="err">最终文本回复</span>
</code></pre></div>

<h3 id="52-tool-result">5.2 Tool Result 截断（运行中）</h3>
<p><strong><code>truncateToolResultText</code></strong> (model-context-tokens-z5hvDVkk.js)</p>
<div class="codehilite"><pre><span></span><code>长度 &lt;= maxChars → 原样返回

长度 &gt; maxChars:
  ├─ 尾部含重要信号词（error/failed/traceback/exception/warning/fatal）
  │    → 头尾保留策略
  │       headBudget = 70% × (maxChars - suffix_len)
  │       tailBudget = 30% × (maxChars - suffix_len)
  │       中间插入: &quot;\n[...output truncated...]\n&quot;
  │
  └─ 尾部无重要信号词
       → 头部保留策略
          cutPoint = maxChars - suffix_len（在最近换行符处截断，若 &gt; 80% budget）
          插入: &quot;\n[...truncated, use a more specific query...]\n&quot;

极端情况（超过 maxSingleToolResultChars ~240,000 chars）:
  → Context Guard 直接截断，不走上述两级逻辑
  → 插入: &quot;\n[TOOL RESULT TRUNCATED: exceeded single result limit]\n&quot;
  → 截断后总量仍超 maxContextChars → 抛出 PREEMPTIVE_CONTEXT_OVERFLOW
</code></pre></div>

<h3 id="53-session-manager">5.3 Session Manager 守卫</h3>
<p><strong><code>guardSessionManager</code></strong> (model-context-tokens-z5hvDVkk.js)</p>
<ul>
<li>在 assistant message 之前 flush pending tool results</li>
<li>在新 tool call 之前 flush</li>
<li>确保 tool result 不堆积</li>
</ul>
<h3 id="54-thinking-block">5.4 Thinking Block 处理</h3>
<p><strong><code>dropThinkingBlocks</code></strong> (model-context-tokens-z5hvDVkk.js)</p>
<ul>
<li><code>reasoningLevel === "off"</code> → 剥离 thinking block，只保留 final</li>
<li><code>reasoningLevel !== "off"</code> → 保留但标记为 hidden（不展示给用户）</li>
<li>alibaba provider：LLM 生成的 <code>&lt;thinking&gt;...&lt;/thinking&gt;</code> 标签同样被此函数识别处理</li>
</ul>
<hr />
<h2 id="phase-6-post-processing">Phase 6: 后处理（Post-processing）</h2>
<h3 id="61-compaction">6.1 Compaction 触发（运行时）</h3>
<p>Pi 内部检测到上下文接近上限 → 触发 <code>session_before_compact</code> hook</p>
<p><strong>Safeguard 模式流程：</strong></p>
<div class="codehilite"><pre><span></span><code><span class="n">Pi</span><span class="o">:</span><span class="w"> </span><span class="n">session_before_compact</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">OpenClaw</span><span class="o">:</span><span class="w"> </span><span class="n">compactionSafeguardExtension</span>
<span class="w">  </span><span class="err">↓</span>
<span class="mi">1</span><span class="o">.</span><span class="w"> </span><span class="n">splitPreservedRecentTurns</span><span class="o">()</span><span class="w">     </span><span class="err">→</span><span class="w"> </span><span class="err">保留最近</span><span class="w"> </span><span class="mi">3</span><span class="w"> </span><span class="err">轮</span>
<span class="mi">2</span><span class="o">.</span><span class="w"> </span><span class="n">buildCompactionStructureInstructions</span><span class="o">()</span>
<span class="w">     </span><span class="err">→</span><span class="w"> </span><span class="err">生成结构化摘要指令</span><span class="o">:</span>
<span class="w">        </span><span class="n">Decisions</span><span class="w"> </span><span class="sr">/ TODOs / Constraints / Pending asks /</span><span class="w"> </span><span class="n">Exact</span><span class="w"> </span><span class="n">identifiers</span>
<span class="mi">3</span><span class="o">.</span><span class="w"> </span><span class="n">summarizeViaLLM</span><span class="o">()</span>
<span class="w">     </span><span class="err">→</span><span class="w"> </span><span class="n">summarizeInStages</span><span class="o">()</span><span class="err">（历史过长时分</span><span class="w"> </span><span class="n">chunk</span><span class="err">）</span>
<span class="w">        </span><span class="err">→</span><span class="w"> </span><span class="err">每</span><span class="w"> </span><span class="n">chunk</span><span class="w"> </span><span class="err">调用</span><span class="w"> </span><span class="n">summarizeWithFallback</span><span class="o">()</span><span class="err">（见</span><span class="w"> </span><span class="n">Fallback</span><span class="w"> </span><span class="err">章节）</span>
<span class="w">     </span><span class="err">→</span><span class="w"> </span><span class="n">mergeChunkSummaries</span><span class="o">()</span>
<span class="w">        </span><span class="err">→</span><span class="w"> </span><span class="err">合并后超长</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">对摘要再做一次</span><span class="w"> </span><span class="n">summarize</span>
<span class="mi">4</span><span class="o">.</span><span class="w"> </span><span class="err">拼接</span><span class="w"> </span><span class="n">suffix</span><span class="o">:</span>
<span class="w">     </span><span class="n">preservedRecentTurns</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="n">toolFailures</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="n">fileOps</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="n">workspaceContext</span>
<span class="mi">5</span><span class="o">.</span><span class="w"> </span><span class="n">capCompactionSummaryPreservingSuffix</span><span class="o">()</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">上限</span><span class="w"> </span><span class="mi">16</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">chars</span><span class="err">（尾部截断）</span>
<span class="mi">6</span><span class="o">.</span><span class="w"> </span><span class="err">写入</span><span class="w"> </span><span class="n">compaction</span><span class="w"> </span><span class="n">entry</span><span class="err">，替换原始消息</span>
</code></pre></div>

<h3 id="62-post-compaction">6.2 Post-Compaction 刷新</h3>
<p><strong><code>readPostCompactionContext</code></strong> (post-compaction-context.ts:3568)</p>
<p>压缩完成后注入：</p>
<div class="codehilite"><pre><span></span><code><span class="k">[Post-compaction context refresh]</span>

<span class="na">Session was just compacted. The conversation summary above is a hint,</span>
<span class="na">NOT a substitute for your startup sequence. Run your Session Startup</span>
<span class="na">sequence - read the required files before responding to the user.</span>

<span class="na">Critical rules from AGENTS.md</span><span class="o">:</span>
<span class="k">[AGENTS.md 的 Session Startup 和 Red Lines 章节]</span>
</code></pre></div>

<h3 id="63-session">6.3 Session 文件写入</h3>
<p>每轮对话以 JSONL 格式追加：</p>
<div class="codehilite"><pre><span></span><code><span class="p">{</span><span class="nt">&quot;type&quot;</span><span class="p">:</span><span class="s2">&quot;message&quot;</span><span class="p">,</span><span class="nt">&quot;role&quot;</span><span class="p">:</span><span class="s2">&quot;user&quot;</span><span class="p">,</span><span class="nt">&quot;content&quot;</span><span class="p">:[</span><span class="err">...</span><span class="p">]}</span>
<span class="p">{</span><span class="nt">&quot;type&quot;</span><span class="p">:</span><span class="s2">&quot;message&quot;</span><span class="p">,</span><span class="nt">&quot;role&quot;</span><span class="p">:</span><span class="s2">&quot;assistant&quot;</span><span class="p">,</span><span class="nt">&quot;content&quot;</span><span class="p">:[</span><span class="err">...</span><span class="p">],</span><span class="nt">&quot;tool_calls&quot;</span><span class="p">:[</span><span class="err">...</span><span class="p">]}</span>
<span class="p">{</span><span class="nt">&quot;type&quot;</span><span class="p">:</span><span class="s2">&quot;tool_result&quot;</span><span class="p">,</span><span class="nt">&quot;toolResult&quot;</span><span class="p">:{</span><span class="err">...</span><span class="p">}}</span>
<span class="p">{</span><span class="nt">&quot;type&quot;</span><span class="p">:</span><span class="s2">&quot;compaction&quot;</span><span class="p">,</span><span class="nt">&quot;summary&quot;</span><span class="p">:</span><span class="s2">&quot;...&quot;</span><span class="p">,</span><span class="nt">&quot;firstKeptEntryId&quot;</span><span class="p">:</span><span class="s2">&quot;...&quot;</span><span class="p">}</span>
</code></pre></div>

<h3 id="64">6.4 副作用</h3>
<p><strong><code>runPostCompactionSideEffects</code></strong> (model-context-tokens-z5hvDVkk.js:5923)</p>
<div class="codehilite"><pre><span></span><code><span class="mf">1.</span><span class="w"> </span><span class="n">emitSessionTranscriptUpdate</span><span class="p">(</span><span class="n">sessionFile</span><span class="p">)</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">触发</span><span class="w"> </span><span class="n">transcript</span><span class="w"> </span><span class="n">索引更新</span>
<span class="mf">2.</span><span class="w"> </span><span class="n">syncPostCompactionSessionMemory</span><span class="p">()</span><span class="w">        </span><span class="err">→</span><span class="w"> </span><span class="n">同步</span><span class="w"> </span><span class="n">memory</span><span class="w"> </span><span class="n">索引</span>
</code></pre></div>

<hr />
<h2 id="skills">Skills 子系统</h2>
<h3 id="skills_1">Skills 是什么</h3>
<p>Skill 是对 tool 的更高层封装。tool 是原子操作（<code>exec</code>、<code>web_fetch</code> 等），skill 是&rdquo;有名字、有描述、可被 LLM 感知的复合能力单元&rdquo;。LLM 不直接看到 skill 实现，而是通过 system prompt 的 <code>## Skills (mandatory)</code> 区块感知它们的存在。</p>
<h3 id="skill">Skill 注册机制</h3>
<div class="codehilite"><pre><span></span><code><span class="n">openclaw</span><span class="o">.</span><span class="n">json</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">skills</span><span class="p">[]</span><span class="w"> </span><span class="err">字段</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">loadSkillsForAgent</span><span class="p">()</span><span class="w"> </span><span class="p">(</span><span class="n">skill</span><span class="o">-</span><span class="n">loader</span><span class="o">.</span><span class="n">ts</span><span class="p">)</span>
<span class="w">  </span><span class="err">↓</span>
<span class="w">  </span><span class="mf">1.</span><span class="w"> </span><span class="err">扫描</span><span class="w"> </span><span class="n">skills</span><span class="o">/</span><span class="w"> </span><span class="err">目录下的</span><span class="w"> </span><span class="o">.</span><span class="n">skill</span><span class="o">.</span><span class="n">md</span><span class="w"> </span><span class="o">/</span><span class="w"> </span><span class="o">.</span><span class="n">skill</span><span class="o">.</span><span class="n">js</span><span class="w"> </span><span class="err">文件</span>
<span class="w">  </span><span class="mf">2.</span><span class="w"> </span><span class="err">解析</span><span class="w"> </span><span class="n">frontmatter</span><span class="err">（</span><span class="n">name</span><span class="p">,</span><span class="w"> </span><span class="n">description</span><span class="p">,</span><span class="w"> </span><span class="n">trigger_patterns</span><span class="p">,</span><span class="w"> </span><span class="n">requires_tools</span><span class="p">[]</span><span class="err">）</span>
<span class="w">  </span><span class="mf">3.</span><span class="w"> </span><span class="err">过滤</span><span class="p">:</span><span class="w"> </span><span class="err">当前</span><span class="w"> </span><span class="n">agent</span><span class="w"> </span><span class="err">权限</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="err">所需</span><span class="w"> </span><span class="k">tool</span><span class="w"> </span><span class="err">是否可用（</span><span class="n">TOOLS</span><span class="o">.</span><span class="n">md</span><span class="w"> </span><span class="err">不控制</span><span class="w"> </span><span class="n">skill</span><span class="w"> </span><span class="err">可用性）</span>
<span class="w">  </span><span class="mf">4.</span><span class="w"> </span><span class="err">返回</span><span class="w"> </span><span class="n">SkillManifest</span><span class="p">[]</span>
</code></pre></div>

<h3 id="system-prompt">System Prompt 注入格式</h3>
<div class="codehilite"><pre><span></span><code>##<span class="w"> </span>Skills<span class="w"> </span>(mandatory)

Before<span class="w"> </span>replying,<span class="w"> </span>scan<span class="w"> </span><span class="nt">&lt;available_skills&gt;</span><span class="w"> </span>for<span class="w"> </span>relevant<span class="w"> </span>capabilities.
Prefer<span class="w"> </span>skills<span class="w"> </span>over<span class="w"> </span>raw<span class="w"> </span>tool<span class="w"> </span>calls<span class="w"> </span>when<span class="w"> </span>a<span class="w"> </span>skill<span class="w"> </span>name<span class="w"> </span>matches<span class="w"> </span>the<span class="w"> </span>intent.

<span class="nt">&lt;available_skills&gt;</span>
-<span class="w"> </span>weather:<span class="w">       </span>查询城市天气，支持中英文城市名。requires:<span class="w"> </span>web_fetch
-<span class="w"> </span>memory_recall:<span class="w"> </span>从长期记忆检索相关内容。requires:<span class="w"> </span>memory_search,<span class="w"> </span>memory_get
-<span class="w"> </span>image_gen:<span class="w">     </span>生成图片。requires:<span class="w"> </span>image_generate
-<span class="w"> </span>...（共<span class="w"> </span>12<span class="w"> </span>个）
<span class="nt">&lt;/available_skills&gt;</span>
</code></pre></div>

<h3 id="skill_1">Skill 执行路径</h3>
<p>Skill <strong>没有独立的执行引擎</strong>。LLM 感知 skill 名称和描述后，在 Tool Loop 里自主编排底层 tool 调用：</p>
<div class="codehilite"><pre><span></span><code><span class="err">普通</span><span class="w"> </span><span class="k">tool</span><span class="w"> </span><span class="n">call</span><span class="p">:</span>
<span class="w">  </span><span class="n">LLM</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">tool_call</span><span class="p">(</span><span class="n">exec</span><span class="p">,</span><span class="w"> </span><span class="p">{</span><span class="n">cmd</span><span class="p">})</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">执行</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">tool_result</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">LLM</span>

<span class="n">Skill</span><span class="w"> </span><span class="err">引导的</span><span class="w"> </span><span class="k">tool</span><span class="w"> </span><span class="n">call</span><span class="p">:</span>
<span class="w">  </span><span class="n">LLM</span><span class="w"> </span><span class="err">感知</span><span class="w"> </span><span class="n">skill</span><span class="w"> </span><span class="s2">&quot;weather&quot;</span>
<span class="w">    </span><span class="err">→</span><span class="w"> </span><span class="n">tool_call</span><span class="p">(</span><span class="n">web_fetch</span><span class="p">,</span><span class="w"> </span><span class="p">{</span><span class="n">url</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;wttr.in/杭州?format=j1&quot;</span><span class="p">})</span>
<span class="w">    </span><span class="err">→</span><span class="w"> </span><span class="n">tool_result</span><span class="err">（</span><span class="n">JSON</span><span class="w"> </span><span class="err">天气数据）</span>
<span class="w">    </span><span class="err">→</span><span class="w"> </span><span class="n">LLM</span><span class="w"> </span><span class="err">解析，生成自然语言回复</span>
<span class="w">  </span><span class="err">（</span><span class="n">OpenClaw</span><span class="w"> </span><span class="err">不介入中间步骤）</span>
</code></pre></div>

<h3 id="skill_2">Skill 失败处理</h3>
<p>Skill 没有独立错误捕获。底层 tool 失败后 LLM 自主决策（重试、改用其他 tool、告知用户）。建议在 skill description 里加入失败场景的引导语以提高稳定性。</p>
<hr />
<h2 id="memory">Memory 子系统</h2>
<h3 id="_2">两层结构</h3>
<div class="codehilite"><pre><span></span><code>Layer 1: MEMORY.md（静态注入）
  · 每次 session 启动注入 system prompt
  · 受 bootstrapMaxChars = 12,000 chars 限制
  · 人工或 LLM 在压缩后更新

Layer 2: memory_search / memory_get（动态检索）
  · 结构化条目，存储在 ~/.openclaw/memory/
  · LLM 主动调用，非自动注入
  · 支持向量检索 + 全文检索
</code></pre></div>

<h3 id="memory_1">Memory 写入时机</h3>
<p>由 system prompt 的 <code>📝 Write It Down</code> 规则引导，LLM 在以下情况写入：<br />
1. 用户明确要求记住某事<br />
2. LLM 判断信息具有跨 session 价值（用户偏好、关键标识符等）<br />
3. Compaction 触发时 — <code>syncPostCompactionSessionMemory()</code> 自动提取关键信息</p>
<h3 id="_3">检索机制</h3>
<div class="codehilite"><pre><span></span><code>memory_search(query, options)
  ↓
  1. 向量检索（若配置 embedding backend）
     → embed(query) → 余弦相似度 top-k
  2. 全文检索（fallback 或默认）
     → BM25 / 字符串匹配
  3. 合并结果，按 score 排序

memory_get(id) → 读取具体条目内容
</code></pre></div>

<p><strong>向量 vs 全文：</strong> 取决于 <code>openclaw.json</code> 的 <code>memory.backend</code>。默认纯全文，配置 embedding endpoint 后启用向量检索。向量 API 失败时静默降级到全文。</p>
<h3 id="syncpostcompactionsessionmemory">syncPostCompactionSessionMemory 行为</h3>
<div class="codehilite"><pre><span></span><code>压缩完成后:
  → 读取 compaction summary
  → 提取结构化字段:
      Exact identifiers / Decisions / TODOs
  → 对比现有条目，避免重复写入
  → 将新增条目写入 memory index
  → （可选）更新 MEMORY.md（auto-update-memory-file 配置）
</code></pre></div>

<h3 id="_4">局限性</h3>
<ul>
<li>MEMORY.md 是静态快照，不实时同步</li>
<li>memory_search 召回质量依赖 LLM 的 query 质量</li>
<li>无内置去重/老化机制，长期使用后 MEMORY.md 可能触碰 12,000 chars 上限</li>
</ul>
<hr />
<h2 id="_5">错误处理路径</h2>
<h3 id="llm">LLM 调用失败</h3>
<div class="codehilite"><pre><span></span><code>resolveProviderStreamFn() → API 失败
  ↓
  · 网络错误 / 5xx → exponential backoff 重试（最多 3 次）
  · 4xx（401/429）  → 不重试，直接抛出
  · 超时（默认 120s）→ 按网络错误处理

retry 耗尽:
  → 检查 fallback_provider 配置（见 Fallback 章节）
  → 无配置 → 向用户报错，session 标记 idle
</code></pre></div>

<h3 id="tool">Tool 执行失败</h3>
<p>Tool 失败<strong>不终止 Tool Loop</strong>：</p>
<div class="codehilite"><pre><span></span><code><span class="n">tool_call</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">失败</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">tool_result</span><span class="p">:</span><span class="w"> </span><span class="p">{</span><span class="w"> </span><span class="n">error</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;...&quot;</span><span class="p">,</span><span class="w"> </span><span class="n">success</span><span class="p">:</span><span class="w"> </span><span class="bp">false</span><span class="w"> </span><span class="p">}</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">LLM</span><span class="w"> </span><span class="err">再次调用</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">自主决策</span><span class="p">:</span>
<span class="w">  </span><span class="n">a</span><span class="p">)</span><span class="w"> </span><span class="err">用不同参数重试</span>
<span class="w">  </span><span class="n">b</span><span class="p">)</span><span class="w"> </span><span class="err">改用其他</span><span class="w"> </span><span class="k">tool</span>
<span class="w">  </span><span class="n">c</span><span class="p">)</span><span class="w"> </span><span class="err">向用户报告失败</span>
</code></pre></div>

<p>Compaction Safeguard 在生成摘要时会提取历史 tool failure 记录，附加到摘要 suffix，避免下一 session 重复同样的失败。</p>
<h3 id="preemptive_context_overflow">PREEMPTIVE_CONTEXT_OVERFLOW</h3>
<div class="codehilite"><pre><span></span><code>Context Guard 检测到总量溢出
  ↓
抛出 PREEMPTIVE_CONTEXT_OVERFLOW
  ↓
pi-embedded-runner 捕获
  ↓
强制触发 compaction（不等 Pi 内部检测）
  ↓
压缩完成后重新发起本轮请求
  ↓
压缩后仍溢出 → 报错给用户（&quot;上下文过长，请 /reset&quot;）
</code></pre></div>

<h3 id="compaction-quality-guard">Compaction Quality Guard 失败</h3>
<div class="codehilite"><pre><span></span><code>qualityGuard 检查（长度/identifiers/结构字段）
  ↓
失败 → 重试（最多 2 次）
  ↓
2 次后仍失败 → 强制使用最后一次结果
  ↓
写入 warning 到 session log（不阻断流程）
</code></pre></div>

<h3 id="session">Session 文件损坏</h3>
<div class="codehilite"><pre><span></span><code>JSONL 读取失败（parse error / 文件锁）
  ↓
1. 尝试逐行读取，跳过损坏行
2. 无法恢复 → 创建新 session（isNewSession = true）
3. 保留损坏文件为 .bak 备份
4. 向用户提示 session 已重置
</code></pre></div>

<hr />
<h2 id="provider">Provider 抽象层</h2>
<h3 id="provider_1">Provider 注册结构</h3>
<div class="codehilite"><pre><span></span><code>providers/
  ├── anthropic/
  │   ├── stream.ts        ← SSE 流式处理
  │   ├── cache-control.ts ← cache_control 注入
  │   └── thinking.ts      ← thinking block 处理
  ├── alibaba/
  │   ├── stream.ts        ← OpenAI-compatible SSE
  │   └── model-map.ts     ← modelId 映射
  └── openai/
</code></pre></div>

<p><code>resolveProviderStreamFn()</code> 根据 <code>provider</code> 字段动态 require 对应模块。</p>
<h3 id="provider_2">各 Provider 关键差异</h3>
<table>
<thead>
<tr>
<th>特性</th>
<th>anthropic</th>
<th>alibaba（OpenAI-compat）</th>
<th>openai</th>
</tr>
</thead>
<tbody>
<tr>
<td>cache_control</td>
<td>✅ 原生支持</td>
<td>❌ 忽略</td>
<td>❌ 忽略</td>
</tr>
<tr>
<td>thinking block</td>
<td>✅ 原生</td>
<td>❌ 模拟（<code>&lt;thinking&gt;</code> 标签）</td>
<td>❌ 不支持</td>
</tr>
<tr>
<td>context-pruning (cache-ttl)</td>
<td>✅</td>
<td>❌</td>
<td>❌</td>
</tr>
<tr>
<td>流式格式</td>
<td>Anthropic SSE</td>
<td>OpenAI SSE</td>
<td>OpenAI SSE</td>
</tr>
<tr>
<td>tool_call 格式</td>
<td><code>tool_use</code> block</td>
<td><code>function_call</code></td>
<td><code>function_call</code></td>
</tr>
</tbody>
</table>
<h3 id="anthropic-cache_control">Anthropic 专属：cache_control 注入</h3>
<div class="codehilite"><pre><span></span><code><span class="c1">// SYSTEM_PROMPT_CACHE_BOUNDARY 被转换为:</span>
<span class="nx">messages</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="p">[</span>
<span class="w">  </span><span class="p">{</span>
<span class="w">    </span><span class="nx">role</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;system&quot;</span><span class="p">,</span>
<span class="w">    </span><span class="nx">content</span><span class="o">:</span><span class="w"> </span><span class="p">[</span>
<span class="w">      </span><span class="p">{</span><span class="w"> </span><span class="nx">type</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;text&quot;</span><span class="p">,</span><span class="w"> </span><span class="nx">text</span><span class="o">:</span><span class="w"> </span><span class="nx">stablePart</span><span class="p">,</span><span class="w">  </span><span class="nx">cache_control</span><span class="o">:</span><span class="w"> </span><span class="p">{</span><span class="w"> </span><span class="nx">type</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;ephemeral&quot;</span><span class="w"> </span><span class="p">}</span><span class="w"> </span><span class="p">},</span>
<span class="w">      </span><span class="p">{</span><span class="w"> </span><span class="nx">type</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;text&quot;</span><span class="p">,</span><span class="w"> </span><span class="nx">text</span><span class="o">:</span><span class="w"> </span><span class="nx">dynamicPart</span><span class="w"> </span><span class="p">}</span><span class="w">  </span><span class="c1">// 不缓存</span>
<span class="w">    </span><span class="p">]</span>
<span class="w">  </span><span class="p">},</span>
<span class="w">  </span><span class="p">...</span><span class="nx">userMessages</span>
<span class="p">];</span>
</code></pre></div>

<p>alibaba provider 下，<code>SYSTEM_PROMPT_CACHE_BOUNDARY</code> 作为普通文本出现，不影响功能但略显冗余。</p>
<h3 id="alibaba-thinking">alibaba 的 thinking 模拟</h3>
<div class="codehilite"><pre><span></span><code>provider_override:<span class="w"> </span>interaction_style
<span class="w">  </span>→<span class="w"> </span>system<span class="w"> </span>prompt<span class="w"> </span>注入:
<span class="w">     </span>&quot;When<span class="w"> </span>reasoning<span class="w"> </span>is<span class="w"> </span>needed,<span class="w"> </span>wrap<span class="w"> </span>your<span class="w"> </span>internal<span class="w"> </span>reasoning<span class="w"> </span>in
<span class="w">      </span><span class="nt">&lt;thinking&gt;</span>...<span class="nt">&lt;/thinking&gt;</span><span class="w"> </span>tags<span class="w"> </span>before<span class="w"> </span>your<span class="w"> </span>final<span class="w"> </span>answer.&quot;

dropThinkingBlocks():
<span class="w">  </span>→<span class="w"> </span>识别<span class="w"> </span><span class="nt">&lt;thinking&gt;</span>...<span class="nt">&lt;/thinking&gt;</span>
<span class="w">  </span>→<span class="w"> </span>按<span class="w"> </span>reasoningLevel<span class="w"> </span>决定保留或剥离
<span class="w">  </span>→<span class="w"> </span>注入<span class="w"> </span>session<span class="w"> </span>时标记为<span class="w"> </span>hidden
</code></pre></div>

<h3 id="provider-suffix">Provider 动态 Suffix（示例）</h3>
<p>alibaba 默认 suffix（Phase 2 [30]）：</p>
<div class="codehilite"><pre><span></span><code>请用中文回复，除非用户明确要求其他语言。
工具调用时使用英文参数名。
</code></pre></div>

<hr />
<h2 id="hook">完整 Hook 体系</h2>
<h3 id="_6">三层总览</h3>
<div class="codehilite"><pre><span></span><code><span class="n">Layer</span><span class="w"> </span><span class="mh">1</span><span class="o">:</span><span class="w"> </span><span class="err">插件</span><span class="w"> </span><span class="n">Hook</span><span class="err">（</span><span class="n">Plugin</span><span class="w"> </span><span class="n">Hooks</span><span class="err">）</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">openclaw</span><span class="w"> </span><span class="err">插件通过</span><span class="w"> </span><span class="n">registerHook</span><span class="p">()</span><span class="w"> </span><span class="err">注册，异步，可阻断</span>

<span class="n">Layer</span><span class="w"> </span><span class="mh">2</span><span class="o">:</span><span class="w"> </span><span class="n">Internal</span><span class="w"> </span><span class="n">Hook</span><span class="err">（</span><span class="n">OpenClaw</span><span class="w"> </span><span class="err">内部模块间）</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="err">内部事件总线，同步</span><span class="o">/</span><span class="err">异步均有，不对外暴露</span>

<span class="n">Layer</span><span class="w"> </span><span class="mh">3</span><span class="o">:</span><span class="w"> </span><span class="n">Pi</span><span class="w"> </span><span class="n">Hook</span><span class="err">（</span><span class="n">Pi</span><span class="w"> </span><span class="n">Agent</span><span class="w"> </span><span class="err">内部）</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">OpenClaw</span><span class="w"> </span><span class="err">通过</span><span class="w"> </span><span class="n">Pi</span><span class="w"> </span><span class="n">SDK</span><span class="w"> </span><span class="err">注入的生命周期</span><span class="w"> </span><span class="n">hook</span>
</code></pre></div>

<h3 id="hook_1">插件 Hook 完整列表</h3>
<table>
<thead>
<tr>
<th>Hook 名称</th>
<th>触发时机</th>
<th>可阻断</th>
<th>常见用途</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>message_received</code></td>
<td>消息到达、去重后</td>
<td>✅</td>
<td>消息过滤、指令拦截</td>
</tr>
<tr>
<td><code>before_reply</code></td>
<td>LLM 调用前</td>
<td>✅</td>
<td>注入额外 context、修改 prompt</td>
</tr>
<tr>
<td><code>after_reply</code></td>
<td>最终回复生成后</td>
<td>❌</td>
<td>日志、统计</td>
</tr>
<tr>
<td><code>tool_before_exec</code></td>
<td>tool 执行前</td>
<td>✅</td>
<td>权限检查、参数校验</td>
</tr>
<tr>
<td><code>tool_after_exec</code></td>
<td>tool 执行后</td>
<td>❌</td>
<td>结果审计</td>
</tr>
<tr>
<td><code>session_reset</code></td>
<td>/reset 触发后</td>
<td>❌</td>
<td>清理插件状态</td>
</tr>
<tr>
<td><code>agent:bootstrap</code></td>
<td>bootstrap 文件加载后</td>
<td>✅</td>
<td>修改/追加 bootstrap files</td>
</tr>
<tr>
<td><code>compaction_before</code></td>
<td>压缩开始前</td>
<td>✅</td>
<td>注入额外保留内容</td>
</tr>
<tr>
<td><code>compaction_after</code></td>
<td>压缩完成后</td>
<td>❌</td>
<td>触发外部同步</td>
</tr>
<tr>
<td><code>heartbeat_tick</code></td>
<td>心跳轮询触发时</td>
<td>✅</td>
<td>自定义心跳逻辑</td>
</tr>
<tr>
<td><code>channel_send</code></td>
<td>向 channel 推送消息前</td>
<td>✅</td>
<td>消息格式转换、富媒体注入</td>
</tr>
</tbody>
</table>
<h3 id="internal-hook">Internal Hook 完整列表</h3>
<table>
<thead>
<tr>
<th>Hook 名称</th>
<th>触发位置</th>
<th>说明</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>session:before_write</code></td>
<td>JSONL 写入前</td>
<td>可修改写入内容</td>
</tr>
<tr>
<td><code>session:after_write</code></td>
<td>JSONL 写入后</td>
<td>触发索引更新</td>
</tr>
<tr>
<td><code>context:overflow</code></td>
<td>PREEMPTIVE_CONTEXT_OVERFLOW 时</td>
<td>触发强制压缩</td>
</tr>
<tr>
<td><code>memory:before_write</code></td>
<td>memory 条目写入前</td>
<td>去重检查</td>
</tr>
<tr>
<td><code>memory:after_index</code></td>
<td>memory 索引更新后</td>
<td>触发向量 embed</td>
</tr>
<tr>
<td><code>skill:resolved</code></td>
<td>skill 列表确定后</td>
<td>debug/监控</td>
</tr>
<tr>
<td><code>provider:request_built</code></td>
<td>LLM 请求体构建完成</td>
<td>最后修改机会</td>
</tr>
<tr>
<td><code>provider:response_chunk</code></td>
<td>流式响应每个 chunk</td>
<td>实时处理</td>
</tr>
</tbody>
</table>
<h3 id="pi-hookopenclaw">Pi Hook（OpenClaw 注入点）</h3>
<table>
<thead>
<tr>
<th>Pi Hook</th>
<th>OpenClaw 注入内容</th>
</tr>
</thead>
<tbody>
<tr>
<td><code>transformContext</code></td>
<td>Tool Result Context Guard（截断/溢出检测）</td>
</tr>
<tr>
<td><code>session_before_compact</code></td>
<td>Compaction Safeguard（接管压缩逻辑）</td>
</tr>
<tr>
<td><code>onToolCall</code></td>
<td>guardSessionManager（flush pending results）</td>
</tr>
<tr>
<td><code>onAssistantMessage</code></td>
<td>dropThinkingBlocks（thinking block 处理）</td>
</tr>
<tr>
<td><code>onSessionEnd</code></td>
<td>session JSONL 最终写入 + side effects</td>
</tr>
</tbody>
</table>
<hr />
<h2 id="fallback">Fallback 链路详解</h2>
<p>OpenClaw 的 fallback 分布在六个独立层面，没有统一的 fallback 总线。</p>
<h3 id="provider-fallback">Provider 级 Fallback</h3>
<div class="codehilite"><pre><span></span><code>主 provider retry 耗尽
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
</code></pre></div>

<p>注意：fallback provider 的 context window 如果小于主 provider，OpenClaw 不自动处理，需手动配置。</p>
<h3 id="compaction-summarize-fallback">Compaction Summarize Fallback（三级）</h3>
<div class="codehilite"><pre><span></span><code>summarizeWithFallback()
  ↓
尝试 1: safeguard 专用 system prompt + 结构化指令
  → qualityGuard 检查（长度/identifiers/结构字段）
  → 通过 → 使用

尝试 2（失败）: 降低结构化要求，放宽 qualityGuard 标准
  → 移除 Exact identifiers 强制要求

尝试 3（再次失败）: Pi 内置 generateSummary()
  → 使用原始 SUMMARIZATION_SYSTEM_PROMPT
  → 跳过 qualityGuard，强制使用结果
</code></pre></div>

<p><strong>分 chunk 合并：</strong></p>
<div class="codehilite"><pre><span></span><code>chunk_1_summary + ... + chunk_n_summary
  ↓
合并后 &lt; 16,000 chars → 直接拼接
合并后超限 → 对摘要再做一次 summarizeWithFallback()
最终由 capCompactionSummaryPreservingSuffix() 强制截至 16,000 chars
</code></pre></div>

<h3 id="memory-backend-fallback">Memory Backend Fallback</h3>
<div class="codehilite"><pre><span></span><code>memory_search() 调用
  ↓
向量检索（embedding API）
  ↓
API 失败/超时 → 静默 fallback 到全文检索
  → session log 写入 warning，用户不可见

全文检索失败（文件系统错误）:
  → 返回空结果
  → LLM 感知&quot;未找到记忆&quot;，自行决定回答策略
</code></pre></div>

<h3 id="bootstrap-fallback">Bootstrap 文件 Fallback</h3>
<table>
<thead>
<tr>
<th>情况</th>
<th>处理方式</th>
<th>用户可见</th>
</tr>
</thead>
<tbody>
<tr>
<td>文件不存在</td>
<td>注入 <code>[MISSING] Expected at: &lt;path&gt;</code></td>
<td>⚠️ LLM 感知</td>
</tr>
<tr>
<td>文件读取失败</td>
<td>同上</td>
<td>⚠️ LLM 感知</td>
</tr>
<tr>
<td>文件存在但为空</td>
<td>注入空内容</td>
<td>❌</td>
</tr>
<tr>
<td>HEARTBEAT.md 不存在</td>
<td>注入默认心跳提示词</td>
<td>❌</td>
</tr>
</tbody>
</table>
<h3 id="tool-result-fallback">Tool Result 截断 Fallback（三级）</h3>
<div class="codehilite"><pre><span></span><code>Level 1（truncateToolResultText）:
  尾部有错误信号词 → 头尾保留（70% head + 30% tail）
  尾部无错误信号词 → 头部保留，尾部截断

Level 2（Context Guard 单条限制）:
  超过 maxSingleToolResultChars（~240,000 chars）
  → 强制截断，插入 [TOOL RESULT TRUNCATED]

Level 3（Context Guard 总量限制）:
  截断后总量仍超 maxContextChars（~400,000 chars）
  → 抛出 PREEMPTIVE_CONTEXT_OVERFLOW → 触发强制压缩
</code></pre></div>

<h3 id="skill-fallback">Skill Fallback</h3>
<p>Skill 无独立 fallback 引擎，完全依赖 LLM 在 Tool Loop 内的自主推理：</p>
<div class="codehilite"><pre><span></span><code><span class="n">skill</span><span class="w"> </span><span class="err">底层</span><span class="w"> </span><span class="k">tool</span><span class="w"> </span><span class="err">失败</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">tool_result</span><span class="p">:</span><span class="w"> </span><span class="p">{</span><span class="w"> </span><span class="n">error</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;...&quot;</span><span class="w"> </span><span class="p">}</span>
<span class="w">  </span><span class="err">↓</span>
<span class="n">LLM</span><span class="w"> </span><span class="err">自主决策</span><span class="p">:</span>
<span class="w">  </span><span class="n">a</span><span class="p">)</span><span class="w"> </span><span class="err">换参数</span><span class="o">/</span><span class="n">URL</span><span class="w"> </span><span class="err">重试</span>
<span class="w">  </span><span class="n">b</span><span class="p">)</span><span class="w"> </span><span class="err">改用其他</span><span class="w"> </span><span class="k">tool</span><span class="err">（如</span><span class="w"> </span><span class="n">web_search</span><span class="w"> </span><span class="err">替代</span><span class="w"> </span><span class="n">web_fetch</span><span class="err">）</span>
<span class="w">  </span><span class="n">c</span><span class="p">)</span><span class="w"> </span><span class="err">从</span><span class="w"> </span><span class="n">MEMORY</span><span class="o">.</span><span class="n">md</span><span class="w"> </span><span class="o">/</span><span class="w"> </span><span class="err">历史对话推断</span>
<span class="w">  </span><span class="n">d</span><span class="p">)</span><span class="w"> </span><span class="err">告知用户无法获取</span>
</code></pre></div>

<h3 id="fallback_1">Fallback 全景对比</h3>
<table>
<thead>
<tr>
<th>层级</th>
<th>触发条件</th>
<th>用户可见</th>
<th>静默处理</th>
<th>可配置</th>
</tr>
</thead>
<tbody>
<tr>
<td>Provider</td>
<td>retry 耗尽</td>
<td>✅ 报错</td>
<td>❌</td>
<td>✅ <code>fallback_provider</code></td>
</tr>
<tr>
<td>Compaction 摘要</td>
<td>quality guard 失败</td>
<td>❌</td>
<td>✅</td>
<td>❌（内置三级）</td>
</tr>
<tr>
<td>Memory 向量检索</td>
<td>embedding API 失败</td>
<td>❌</td>
<td>✅</td>
<td>❌（自动降级）</td>
</tr>
<tr>
<td>Bootstrap 文件</td>
<td>文件缺失/读取失败</td>
<td>⚠️ [MISSING]</td>
<td>部分</td>
<td>❌</td>
</tr>
<tr>
<td>Tool Result 截断</td>
<td>超过长度上限</td>
<td>⚠️ truncated 标记</td>
<td>部分</td>
<td>✅ <code>maxChars</code></td>
</tr>
<tr>
<td>Skill</td>
<td>底层 tool 失败</td>
<td>视 LLM 决策</td>
<td>视 LLM 决策</td>
<td>⚠️ 靠描述引导</td>
</tr>
</tbody>
</table>
<hr />
<h2 id="a">附录 A: 完整实例——&ldquo;帮我查一下杭州天气&rdquo;</h2>
<h3 id="a1">A.1 消息到达</h3>
<div class="codehilite"><pre><span></span><code><span class="err">时间</span><span class="o">:</span><span class="w"> </span><span class="mi">2026</span><span class="o">-</span><span class="mi">04</span><span class="o">-</span><span class="mi">29</span><span class="w"> </span><span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mi">00</span><span class="w"> </span><span class="n">CST</span>
<span class="err">渠道</span><span class="o">:</span><span class="w"> </span><span class="n">webchat</span>
<span class="n">SessionKey</span><span class="o">:</span><span class="w"> </span><span class="n">e4205302</span><span class="o">-</span><span class="mi">4</span><span class="n">b21</span><span class="o">-</span><span class="mi">439</span><span class="n">e</span><span class="o">-</span><span class="mi">805</span><span class="n">e</span><span class="o">-</span><span class="mi">208</span><span class="n">cd0df6647</span>
<span class="err">消息内容</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;帮我查一下杭州天气&quot;</span>
</code></pre></div>

<h3 id="a2">A.2 预处理</h3>
<div class="codehilite"><pre><span></span><code>Gateway 接收 HTTP POST → WebSocket 推送
dispatchReplyFromConfig()
  - session store lookup → 找到已有 session
  - 非重复消息 → 继续
  - 非 fast abort → 继续
getReplyFromConfig()
  - 配置加载: alibaba/glm-5.1
  - sessionId = e4205302-...，isNewSession = false
  - 指令解析: 无 inline 指令
</code></pre></div>

<h3 id="a3-bootstrap">A.3 Bootstrap 注入</h3>
<div class="codehilite"><pre><span></span><code><span class="n">resolveBootstrapContextForRun</span><span class="p">()</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="nl">发现</span><span class="p">:</span>
<span class="w">    </span><span class="n">AGENTS</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">12</span><span class="p">,</span><span class="mi">000</span><span class="w"> </span><span class="n">chars</span><span class="p">)</span><span class="w">  </span><span class="n">SOUL</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">1</span><span class="p">,</span><span class="mi">200</span><span class="p">)</span>
<span class="w">    </span><span class="n">TOOLS</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">3</span><span class="p">,</span><span class="mi">800</span><span class="p">)</span><span class="w">          </span><span class="k">IDENTITY</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">200</span><span class="p">)</span>
<span class="w">    </span><span class="k">USER</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">300</span><span class="p">)</span><span class="w">             </span><span class="n">HEARTBEAT</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">1</span><span class="p">,</span><span class="mi">500</span><span class="p">)</span>
<span class="w">    </span><span class="n">BOOTSTRAP</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✗</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="o">[</span><span class="n">MISSING</span><span class="o">]</span><span class="w"> </span><span class="n">注入</span>
<span class="w">    </span><span class="n">MEMORY</span><span class="p">.</span><span class="n">md</span><span class="w"> </span><span class="err">✓</span><span class="w"> </span><span class="p">(</span><span class="mi">8</span><span class="p">,</span><span class="mi">000</span><span class="p">)</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">total</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">27</span><span class="p">,</span><span class="mi">000</span><span class="w"> </span><span class="n">chars</span><span class="w"> </span><span class="o">&lt;</span><span class="w"> </span><span class="mi">60</span><span class="p">,</span><span class="mi">000</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">无需截断</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">HEARTBEAT</span><span class="w"> </span><span class="n">标记为动态</span><span class="err">，</span><span class="n">稍后注入</span>
</code></pre></div>

<h3 id="a4-system-prompt">A.4 System Prompt 组装</h3>
<div class="codehilite"><pre><span></span><code>buildAgentSystemPrompt()
  → 稳定部分: AGENTS + SOUL + IDENTITY + USER + TOOLS + MEMORY
  → CACHE_BOUNDARY
  → 动态部分: HEARTBEAT
  → Runtime: model=alibaba/glm-5.1 | thinking=low | channel=webchat
  → 最终 system prompt ≈ 35,000 chars (~8,750 tokens)
</code></pre></div>

<h3 id="a5">A.5 压缩触发判断</h3>
<div class="codehilite"><pre><span></span><code><span class="n">estimatedPromptTokens</span><span class="o">:</span>
<span class="w">  </span><span class="n">system</span><span class="w"> </span><span class="n">prompt</span><span class="o">:</span><span class="w"> </span><span class="o">~</span><span class="mi">8</span><span class="o">,</span><span class="mi">750</span><span class="w"> </span><span class="n">tokens</span>
<span class="w">  </span><span class="err">历史消息（</span><span class="mi">15</span><span class="err">条）</span><span class="o">:</span><span class="w"> </span><span class="o">~</span><span class="mi">3</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span>
<span class="w">  </span><span class="err">当前消息</span><span class="o">:</span><span class="w"> </span><span class="o">~</span><span class="mi">10</span><span class="w"> </span><span class="n">tokens</span>
<span class="w">  </span><span class="err">×</span><span class="w"> </span><span class="mf">1.1</span><span class="w"> </span><span class="err">安全余量</span><span class="w"> </span><span class="err">≈</span><span class="w"> </span><span class="mi">12</span><span class="o">,</span><span class="mi">925</span><span class="w"> </span><span class="n">tokens</span>

<span class="n">promptBudgetBeforeReserve</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">160</span><span class="o">,</span><span class="mi">000</span><span class="w"> </span><span class="n">tokens</span>
<span class="n">overflowTokens</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="n">max</span><span class="o">(</span><span class="mi">0</span><span class="o">,</span><span class="w"> </span><span class="mi">12</span><span class="o">,</span><span class="mi">925</span><span class="w"> </span><span class="o">-</span><span class="w"> </span><span class="mi">160</span><span class="o">,</span><span class="mi">000</span><span class="o">)</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="mi">0</span>
<span class="err">→</span><span class="w"> </span><span class="n">route</span><span class="w"> </span><span class="o">=</span><span class="w"> </span><span class="s2">&quot;fits&quot;</span><span class="err">，不触发压缩</span>
</code></pre></div>

<h3 id="a6-llm">A.6 LLM 请求构建</h3>
<div class="codehilite"><pre><span></span><code><span class="err">请求结构</span><span class="o">:</span>
<span class="w">  </span><span class="n">system</span><span class="o">:</span><span class="w"> </span><span class="o">[</span><span class="err">完整</span><span class="w"> </span><span class="n">system</span><span class="w"> </span><span class="n">prompt</span><span class="o">]</span>
<span class="w">  </span><span class="n">messages</span><span class="o">:</span><span class="w"> </span><span class="o">[{</span><span class="w"> </span><span class="n">role</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;user&quot;</span><span class="o">,</span><span class="w"> </span><span class="n">content</span><span class="o">:</span><span class="w"> </span><span class="s2">&quot;帮我查一下杭州天气&quot;</span><span class="w"> </span><span class="o">}]</span>
<span class="w">  </span><span class="n">tools</span><span class="o">:</span><span class="w"> </span><span class="o">[</span><span class="mi">25</span><span class="w"> </span><span class="err">个工具定义</span><span class="o">]</span>
<span class="w">  </span><span class="n">thinking</span><span class="o">:</span><span class="w"> </span><span class="n">low</span>
<span class="w">  </span><span class="n">model</span><span class="o">:</span><span class="w"> </span><span class="n">alibaba</span><span class="o">/</span><span class="n">glm</span><span class="o">-</span><span class="mf">5.1</span>
</code></pre></div>

<h3 id="a7-llm-tool-call">A.7 LLM 响应与 Tool Call</h3>
<div class="codehilite"><pre><span></span><code><span class="n">LLM</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="err">感知</span><span class="w"> </span><span class="n">weather</span><span class="w"> </span><span class="n">skill</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">tool_call</span><span class="p">:</span><span class="w"> </span><span class="n">web_fetch</span><span class="p">(</span><span class="n">url</span><span class="o">=</span><span class="s2">&quot;wttr.in/杭州?format=j1&quot;</span><span class="p">)</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">wttr</span><span class="o">.</span><span class="ow">in</span><span class="w"> </span><span class="n">API</span><span class="w"> </span><span class="err">返回天气</span><span class="w"> </span><span class="n">JSON</span><span class="err">（</span><span class="o">~</span><span class="mi">500</span><span class="w"> </span><span class="n">chars</span><span class="err">，远低于截断阈值）</span>
<span class="w">  </span><span class="err">→</span><span class="w"> </span><span class="n">tool_result</span><span class="w"> </span><span class="err">注入</span><span class="w"> </span><span class="n">session</span>
</code></pre></div>

<h3 id="a8">A.8 最终响应</h3>
<div class="codehilite"><pre><span></span><code><span class="n">LLM</span><span class="w"> </span><span class="err">再次调用（带</span><span class="w"> </span><span class="k">tool</span><span class="w"> </span><span class="n">result</span><span class="err">）→</span><span class="w"> </span><span class="err">生成回复</span><span class="p">:</span>
<span class="w">  </span><span class="s2">&quot;杭州现在 19°C，小雨，湿度 85%，东南风 2级。&quot;</span>

<span class="err">响应后</span><span class="p">:</span>
<span class="w">  </span><span class="o">-</span><span class="w"> </span><span class="n">session</span><span class="w"> </span><span class="n">JSONL</span><span class="w"> </span><span class="err">追加用户消息</span><span class="w"> </span><span class="o">+</span><span class="w"> </span><span class="err">助手消息</span>
<span class="w">  </span><span class="o">-</span><span class="w"> </span><span class="err">无</span><span class="w"> </span><span class="n">compaction</span><span class="w"> </span><span class="err">触发（</span><span class="n">token</span><span class="w"> </span><span class="err">数远未达阈值）</span>
<span class="w">  </span><span class="o">-</span><span class="w"> </span><span class="err">无</span><span class="w"> </span><span class="n">post</span><span class="o">-</span><span class="n">compaction</span><span class="w"> </span><span class="err">刷新</span>
</code></pre></div>

<h3 id="a9">A.9 完整时序</h3>
<div class="codehilite"><pre><span></span><code><span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.000</span><span class="w">  </span><span class="err">用户发送消息</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.050</span><span class="w">  </span><span class="n">Gateway</span><span class="w"> </span><span class="err">接收，创建</span><span class="w"> </span><span class="n">InboundContext</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.100</span><span class="w">  </span><span class="n">dispatchReplyFromConfig</span><span class="o">()</span><span class="w"> </span><span class="err">开始</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.150</span><span class="w">  </span><span class="n">getReplyFromConfig</span><span class="o">()</span><span class="w"> </span><span class="err">加载配置</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.200</span><span class="w">  </span><span class="n">initSessionState</span><span class="o">()</span><span class="w"> </span><span class="err">加载</span><span class="w"> </span><span class="n">session</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.300</span><span class="w">  </span><span class="n">resolveBootstrapContextForRun</span><span class="o">()</span><span class="w"> </span><span class="err">加载</span><span class="w"> </span><span class="n">bootstrap</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.400</span><span class="w">  </span><span class="n">buildAgentSystemPrompt</span><span class="o">()</span><span class="w"> </span><span class="err">组装</span><span class="w"> </span><span class="n">system</span><span class="w"> </span><span class="n">prompt</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.500</span><span class="w">  </span><span class="n">shouldPreemptivelyCompactBeforePrompt</span><span class="o">()</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">fits</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.550</span><span class="w">  </span><span class="n">runEmbeddedAttempt</span><span class="o">()</span><span class="w"> </span><span class="err">初始化</span><span class="w"> </span><span class="n">Pi</span><span class="w"> </span><span class="n">Agent</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">00.600</span><span class="w">  </span><span class="err">发送</span><span class="w"> </span><span class="n">LLM</span><span class="w"> </span><span class="err">请求（</span><span class="n">streaming</span><span class="err">）</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">01.200</span><span class="w">  </span><span class="n">LLM</span><span class="w"> </span><span class="err">返回</span><span class="w"> </span><span class="n">tool_call</span><span class="err">（</span><span class="n">weather</span><span class="w"> </span><span class="err">→</span><span class="w"> </span><span class="n">web_fetch</span><span class="err">）</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">01.250</span><span class="w">  </span><span class="err">执行</span><span class="w"> </span><span class="n">web_fetch</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">01.800</span><span class="w">  </span><span class="n">wttr</span><span class="o">.</span><span class="na">in</span><span class="w"> </span><span class="n">API</span><span class="w"> </span><span class="err">返回</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">01.850</span><span class="w">  </span><span class="n">tool_result</span><span class="w"> </span><span class="err">注入</span><span class="w"> </span><span class="n">session</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">02.000</span><span class="w">  </span><span class="n">LLM</span><span class="w"> </span><span class="err">再次调用（自动）</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">02.500</span><span class="w">  </span><span class="n">LLM</span><span class="w"> </span><span class="err">返回最终文本</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">02.550</span><span class="w">  </span><span class="err">流式输出到</span><span class="w"> </span><span class="n">webchat</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">02.600</span><span class="w">  </span><span class="n">session</span><span class="w"> </span><span class="n">JSONL</span><span class="w"> </span><span class="err">写入</span>
<span class="mi">14</span><span class="o">:</span><span class="mi">50</span><span class="o">:</span><span class="mf">02.650</span><span class="w">  </span><span class="err">清理，</span><span class="n">session</span><span class="w"> </span><span class="err">标记</span><span class="w"> </span><span class="n">idle</span>
</code></pre></div>

<hr />
<h2 id="b">附录 B: 关键源码文件映射</h2>
<table>
<thead>
<tr>
<th>功能</th>
<th>源码文件</th>
<th>关键函数</th>
</tr>
</thead>
<tbody>
<tr>
<td>消息调度</td>
<td><code>dispatch-JNo_iJw5.js</code></td>
<td><code>dispatchReplyFromConfig()</code></td>
</tr>
<tr>
<td>Reply 配置</td>
<td><code>get-reply-XW5nFnK2.js</code></td>
<td><code>getReplyFromConfig()</code>, <code>runPreparedReply()</code></td>
</tr>
<tr>
<td>嵌入式运行</td>
<td><code>pi-embedded-runner-DN0VbqlW.js</code></td>
<td><code>runEmbeddedAttempt()</code></td>
</tr>
<tr>
<td>System Prompt 组装</td>
<td><code>system-prompt-D8lixhp6.js</code></td>
<td><code>buildAgentSystemPrompt()</code></td>
</tr>
<tr>
<td>Bootstrap 文件</td>
<td><code>bootstrap-files-ZYTN7n8L.js</code></td>
<td><code>resolveBootstrapContextForRun()</code></td>
</tr>
<tr>
<td>工作区扫描</td>
<td><code>workspace-hhTlRYqM.js</code></td>
<td><code>loadWorkspaceBootstrapFiles()</code></td>
</tr>
<tr>
<td>Bootstrap 预算</td>
<td><code>pi-embedded-helpers-6UMMUO8y.js</code></td>
<td><code>buildBootstrapContextFiles()</code></td>
</tr>
<tr>
<td>Skill 加载</td>
<td><code>skill-loader.ts</code></td>
<td><code>loadSkillsForAgent()</code></td>
</tr>
<tr>
<td>Memory 检索</td>
<td><code>memory-index.ts</code></td>
<td><code>memory_search()</code>, <code>memory_get()</code></td>
</tr>
<tr>
<td>压缩触发判断</td>
<td><code>pi-embedded-runner-DN0VbqlW.js</code></td>
<td><code>shouldPreemptivelyCompactBeforePrompt()</code></td>
</tr>
<tr>
<td>压缩安全机制</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>compactWithSafetyTimeout()</code></td>
</tr>
<tr>
<td>Safeguard 摘要</td>
<td><code>compaction-safeguard.ts</code></td>
<td><code>summarizeViaLLM()</code>, <code>summarizeWithFallback()</code></td>
</tr>
<tr>
<td>Pi 内置摘要</td>
<td><code>compaction.js</code> (Pi)</td>
<td><code>generateSummary()</code></td>
</tr>
<tr>
<td>Tool Result 截断</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>truncateToolResultText()</code></td>
</tr>
<tr>
<td>Context Guard</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>installToolResultContextGuard()</code></td>
</tr>
<tr>
<td>Post-Compaction</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>readPostCompactionContext()</code></td>
</tr>
<tr>
<td>Session 管理</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>guardSessionManager()</code></td>
</tr>
<tr>
<td>Post-Compaction 副作用</td>
<td><code>model-context-tokens-z5hvDVkk.js</code></td>
<td><code>runPostCompactionSideEffects()</code></td>
</tr>
<tr>
<td>Memory 同步</td>
<td><code>post-compaction-context.ts</code></td>
<td><code>syncPostCompactionSessionMemory()</code></td>
</tr>
<tr>
<td>常量定义</td>
<td><code>pi-compaction-constants.ts</code></td>
<td><code>MIN_PROMPT_BUDGET_TOKENS</code>, <code>SAFETY_MARGIN</code></td>
</tr>
</tbody>
</table>
<hr />
<h2 id="c">附录 C: 你的实际配置快照</h2>
<div class="codehilite"><pre><span></span><code><span class="p">{</span>
<span class="w">  </span><span class="nt">&quot;model&quot;</span><span class="p">:</span><span class="w"> </span><span class="p">{</span>
<span class="w">    </span><span class="nt">&quot;provider&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;alibaba&quot;</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;modelId&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;glm-5.1&quot;</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;contextWindow&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">200000</span>
<span class="w">  </span><span class="p">},</span>
<span class="w">  </span><span class="nt">&quot;compaction&quot;</span><span class="p">:</span><span class="w"> </span><span class="p">{</span>
<span class="w">    </span><span class="nt">&quot;mode&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;safeguard&quot;</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;reserveTokens&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">40000</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;keepRecentTokens&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">20000</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;notifyUser&quot;</span><span class="p">:</span><span class="w"> </span><span class="kc">true</span>
<span class="w">  </span><span class="p">},</span>
<span class="w">  </span><span class="nt">&quot;bootstrap&quot;</span><span class="p">:</span><span class="w"> </span><span class="p">{</span>
<span class="w">    </span><span class="nt">&quot;bootstrapMaxChars&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">12000</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;bootstrapTotalMaxChars&quot;</span><span class="p">:</span><span class="w"> </span><span class="mi">60000</span><span class="p">,</span>
<span class="w">    </span><span class="nt">&quot;bootstrapPromptTruncationWarning&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;once&quot;</span>
<span class="w">  </span><span class="p">},</span>
<span class="w">  </span><span class="nt">&quot;contextInjection&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;always&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;thinking&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;low&quot;</span><span class="p">,</span>
<span class="w">  </span><span class="nt">&quot;reasoning&quot;</span><span class="p">:</span><span class="w"> </span><span class="s2">&quot;off&quot;</span>
<span class="p">}</span>
</code></pre></div>

<hr />
<h2 id="_7">设计要点总结</h2>
<p><strong>七道防线，层层兜底：</strong></p>
<ol>
<li><strong>Bootstrap 预算控制</strong> — 文件注入上限（12K/60K chars），避免 system prompt 膨胀</li>
<li><strong>System Prompt Stable/Dynamic 分离</strong> — Anthropic cache_control 优化；HEARTBEAT.md 作为唯一动态文件</li>
<li><strong>Preemptive Compaction</strong> — LLM 调用前评估，溢出前主动压缩</li>
<li><strong>Compaction Safeguard</strong> — 接管 Pi 内置压缩，结构化摘要 + 三级 fallback + identifiers 保护</li>
<li><strong>Tool Result 截断</strong> — 运行时单条/总量双限制，三级截断策略</li>
<li><strong>Post-Compaction 刷新</strong> — 确保压缩后 agent 不丢失关键启动指令</li>
<li><strong>Fallback 链路</strong> — Provider / 摘要 / Memory / Bootstrap / Tool Result / Skill 六层各自兜底</li>
</ol>
<p><strong>可扩展性：</strong> 插件 Hook（11个）→ Internal Hook（8个）→ Pi Hook（5个），三层各自独立，层层可介入。</p>
<hr />
<p><em>文档版本 v2026.4.15-final。如需补充任何环节的源码细节，告诉我。</em></p>

