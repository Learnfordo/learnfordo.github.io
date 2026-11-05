# 中国新媒体大会 · 直播监控 H5

移动端大会监控页：**最新动态 / 高光图片 / 高光视频** 三个 Tab，内容来自真实片源的转写摘要、视频抽帧和高光切片。当前数据为 **VOD 模拟直播彩排** 产物，页面会明确标注 SIMULATION 与测试片源。

- 公网地址：<https://learnfordo.github.io/new-media-live-monitor/>
- 30 倍速模拟回放（验收用）：<https://learnfordo.github.io/new-media-live-monitor/?replay=1>
- 本地预览：`python3 -m http.server 8765 --directory .` 后打开 `http://127.0.0.1:8765/`

> 当前测试片源为 B 站公开视频《2025中国互联网大会-开幕式【完整版】》（BV1Ka8MzbEEs），从 02:38:55 起截取 47 分 25 秒作为“模拟直播”。它不是目标大会的真实现场；正式接入时替换片源与品牌即可。原始视频只保存在本地 `runtime/`，公网只发布摘要、抽帧和短切片。

## 数据与页面行为

- `data/content.json` 是唯一内容源：`meta / timeline / photos / videos`，全部带稳定 ID 与相对媒体时间 `at_ms`；`reveal_ms` 表示模拟回放中该条内容的揭示时间。
- 页面每 20 秒轮询 JSON（真实直播更新时自动重绘）；`?replay=1` 时按 `meta.replaySpeed`（30 倍）依 `reveal_ms` 逐条揭示，用于验收“直播感”。
- 首次打开若 JSON 尚未发布（404/处理中），页面先显示内置 Mock，并在下一次轮询自动切换到真实数据，无需刷新。
- 媒体 URL 只接受本页 `assets/`、`media/` 下的相对路径，外部或越界地址会被丢弃。
- `mock-data.js` 仅作为 `file://` 离线预览回退，不再是正式数据源。

## 生成管线（scripts/）

依赖：`python3`、`curl`、`ffmpeg`、`ffprobe`、Python 包 `dashscope`；ASR/LLM 凭据只从环境变量 `DASHSCOPE_API_KEY` 读取（可 `set -a; source ~/.octop/.env; set +a` 注入，勿打印）。

```bash
# 1) 截取公开 B 站 VOD 区间（--duration 仅彩排用；省略则到片源自然结束）
python3 scripts/fetch_bilibili.py --url 'https://www.bilibili.com/video/BV1Ka8MzbEEs?t=9535.1' \
  --start 9535.1 --output runtime/BV1Ka8MzbEEs/source.mp4

# 2) 分片 → ASR（可断点续跑）→ 2 分钟滚动摘要 → 10 分钟环节摘要/高光/抽帧 → content.json
python3 scripts/replay_pipeline.py --source runtime/BV1Ka8MzbEEs/source.mp4 \
  --public-root . --workers 2

# 3) 校验 JSON 引用、媒体存在性、时间一致性与播放属性
python3 scripts/verify_feed.py --public-root .

# 4) 真实浏览器验收（需 playwright；可选 CHROMIUM_EXECUTABLE 指定 headless shell）
PLAYWRIGHT_MODULE=<path>/node_modules/playwright node scripts/browser_check.js

# 5) 发布到既有 Astro Pages 仓库的 public/new-media-live-monitor/（只暂存该子目录）
bash scripts/deploy_pages.sh /path/to/learnfordo.github.io .
```

管线要点：

- 30 秒分片，清单记录每片真实时长与累计偏移；复用缓存前校验总时长，避免彩排片段污染正式任务。
- **所有分片（含尾片）都会转写**；VOD 自然结束即完成，不存在直播断流重采。
- 滚动摘要按媒体时间从 0 顺序排空窗口，不会只总结最后一批句子。
- 高光以 ASR 句子边界选段（15–45 秒），ffmpeg 重编码为 H.264+AAC；每个环节另抽 3 帧 JPEG。
- 全部产物 ID 稳定，重跑幂等替换；`runtime/` 保存源视频、分片、ASR 缓存与状态，不进仓库、不上公网。

## Octop 专家封装

本目录同时是大会专用专家包：`manifest.json`、`SOUL.md`、`IDENTITY.md` 与 `skills/conference-live/SKILL.md`（含脚本副本）。它继承「直播搭子」的转写/摘要/高光纪律，新增 VOD 起点、尾片排空、静态发布与模拟标注规则。真实直播的持续采集仍联动 `live-companion` 引擎，本专家负责 H5 schema、发布与验收。

## 文件结构

```text
new-media-live-monitor/
├── index.html                  # 页面、样式、交互与数据轮询/模拟回放
├── mock-data.js                # 仅 file:// 离线回退
├── data/content.json           # 生成的正式内容（timeline/photos/videos）
├── media/photos|videos/        # 真实抽帧与高光切片
├── assets/                     # 初版示意图与演示视频（Mock 回退用）
├── scripts/                    # 下载、管线、校验、浏览器验收、发布
├── skills/conference-live/     # 大会专家技能与脚本副本
├── manifest.json / SOUL.md / IDENTITY.md
└── runtime/                    # 本地源视频、分片、ASR 缓存（不发布）
```
