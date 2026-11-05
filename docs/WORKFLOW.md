# GeekReel 短剧流水线 · 工作流说明

> 一句话：给一段故事，自动拆集、定妆、分镜、出图、出视频、配音、成片导出竖屏短剧。
> 本文是给"接手这个仓库的人或模型"看的地图，读完应能定位任何一环的实现位置与已知坑。

---

## 1. 怎么跑起来

```bash
bun install
bun run dev          # 同时起 server(4780) + web(5473)
```

| 项 | 值 | 备注 |
|---|---|---|
| 前端 | http://localhost:5473 | Vite **只监听 IPv6**，必须用 `localhost`，不能用 `127.0.0.1` |
| 后端 | http://localhost:4780 | Hono，前端自动代理 |
| 数据库 | `~/.video-workbench/vw.db` | SQLite，表：projects / assets / jobs / model_endpoints / model_usage |
| 项目产物 | `~/VideoWorkbench/projects/<日期>_<标题>_<id4>/` | 每项目独立目录 |
| 运行时 | Bun ≥1.2 | 非 Node；用了 `bun:sqlite`、`Bun.spawn` |

**关键陷阱**：`bun run dev` 的 `--watch` 只监视 `apps/*`，**不监视 `packages/*`**。
改了 `packages/models`、`packages/pipeline`、`packages/media` 必须手动重启进程，否则跑的还是旧代码——这个坑已经坑过多次（表现为"改了没生效"）。

类型检查 / 测试：

```bash
bun run typecheck    # 各包 tsc --noEmit
bun test             # 191 项
```

---

## 2. 模块地图

```
apps/
  server/           Hono API + 任务队列 + 业务编排
    services/
      pipeline.ts   总编排：故事→剧本→定妆→分镜→出集（949 行，最重）
      episode.ts    出集主循环：逐镜 图→视频→质检→配音→时间线（498 行，最核心）
      dub.ts        配音编排：分段、对齐、混音（520 行）
      compose.ts    剧本/方案生成（调 LLM，带 fallback）
      entityArt.ts  定妆照三视图生成
      library.ts    资产入库（文件落盘 + SQLite 记录）
      usage.ts      模型用量计量
      models.ts     端点解析、密钥解密
    jobs/queue.ts   SQLite 任务队列表 + 并发控制 + 进度上报
    routes/         14 个路由文件，见第 4 节
  web/            React19 + Vite + Tailwind，13 个页面
packages/
  core/           全部 TS 类型与常量（DramaBible、TimelineDoc、Shot…）
  pipeline/       纯函数层：剧本解析、角色绑定、镜头语言、质检提示词、音效建议
  models/         模型适配器层：文本/图片/视频/TTS/搜索，每种一个 adapter
  media/          ffmpeg 封装：探测、渲染计划、执行、缩略图
  style/          风格包（画风预设注入提示词）
  analyze/        素材分析（拆镜头、打标签）
  radar/          选题雷达（热点抓取）
  remake/         二创/翻拍
  push/           推送分发
```

两处分层原则：

- **`packages/pipeline` 是纯函数**，不碰网络和数据库，所以能被单测覆盖（191 项测试主要在这层）。
- **`packages/models` 只认配置**（apiKey/baseUrl/model），不认业务；换供应商只改 adapter + 一条 endpoint 记录。

---

## 3. 端到端数据流

```
用户故事（一段文字）
   │
   ├─① draftFreePlan        LLM 拆方案：几集、每集钩子、主要人物
   │                        → FreePlan { episodes[], cast[] }
   │
   ├─② draftScript          LLM 写剧本：scenes[{heading, action, lines[]}]
   │                        → ScriptDoc
   │
   ├─③ buildBible           scenes → shots（每场按台词切镜，标 startSec/endSec）
   │   applyShotLanguage    推断景别/运镜/机位（缺字段才推断）
   │   bindEntitiesToShots  把人物绑到镜（entityIds）
   │   attachSfx            按画面/台词建议音效线索（sfxCue）
   │                        → DramaBible { cast[], episodes[{shots[]}] }
   │
   ├─④ paintViews           每个角色生成定妆三视图 → 资产入库
   │                        cast[].views = { face, full, side, ... }
   │
   └─⑤ renderEpisode        逐镜循环（episode.ts）：
        │
        ├─ 选参考图   faceId = leadCharacterForShot(bible, shot)  ← 按"这一镜谁在画面里"
        │             refs   = 该角色所有定妆视图
        ├─ 首帧       startImage = 上一镜尾帧 ?? 分镜图 ?? 定妆照
        ├─ 画分镜图   paintStill(prompt)         （首镜 / 无图时）
        ├─ 生成视频   videoAdapter.generateVideo({ prompt, image, lastFrame, refs, duration })
        ├─ 质检       LLM 对比参考图，输出 {ok, score, note}；不过则重做一次
        ├─ 配音       TTS(shot.line) → 资产；按镜头时长做 atempo 对齐
        └─ 落时间线   video 轨 / audio 轨 / subtitle 轨 / sfx 轨
   │
   ├─⑥ writeTimeline        timeline/main.json
   └─⑦ /api/timeline/render ffmpeg 渲染 → export/*.mp4
```

### 每步的输入输出

| 步 | 函数 | 输入 | 输出 | 耗时（火山实测） |
|---|---|---|---|---|
| ① | `draftFreePlan` | 故事文本 | `FreePlan` | ~50s |
| ② | `draftScript` | 故事 + 方案 | `ScriptDoc` | 同上（一次调用产出） |
| ③ | `buildBible` | `ScriptDoc` | `DramaBible` | <1s（纯函数） |
| ④ | `paintViews` | 角色档案 | 定妆图资产 | 12s/张 |
| ⑤ | `renderEpisode` | bible + 端点 | 时间线 | 24s/镜（5s 480p） |
| ⑦ | `/api/timeline/render` | 时间线 | mp4 | 6s（15s 片） |

---

## 4. HTTP 接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/health` | 探活 |
| GET/POST | `/api/projects` | 项目列表 / 新建 |
| POST | `/api/pipelines/run` | 故事 → 方案+剧本（异步任务） |
| POST | `/api/pipelines/:id/advance` | 推进流水线（定妆 / 分镜） |
| POST | `/api/pipelines/render-episode` | 渲染某一集 |
| POST | `/api/timeline/render` | 时间线导出 mp4（`burnSubs` 控制烧字幕） |
| POST | `/api/gen/text` | 直接调文本 |
| POST | `/api/gen/image` | 直接调生图 |
| POST | `/api/gen/video` | 直接调生视频（可带首帧/尾帧） |
| POST | `/api/gen/tts` | 直接调配音 |
| GET | `/api/jobs/:id` | 任务状态 + 进度 + 错误 |
| GET/POST | `/api/models/endpoints` | 模型端点增删改查 |
| POST | `/api/models/endpoints/:id/test` | 连通性自检 |

所有生成走**任务队列**，接口只返回 `jobId`，前端轮询 `/api/jobs/:id`。
返回体统一 `{ ok: true, data }` 或 `{ ok: false, error }`。

---

## 5. 落盘结构

```
~/VideoWorkbench/projects/1105_深夜十一点，外卖员陈默接到最后一_3fbc/
  pipeline/bible.json     剧本总档（cast + episodes + shots，每镜带资产 ID/质检/备注）
  timeline/main.json      时间线（video/audio/subtitle/sfx 四轨）
  export/20261105-1018_….mp4
  assets/…                图片、视频、音频原件
```

`bible.json` 是唯一真相源：某镜出了什么问题（`qa.note`、`lipsNote`）都写在这里，排障先看它。

---

## 6. 模型接入矩阵（含实测坑）

全部走"端点"抽象（`model_endpoints` 表），一个端点 = 一个 adapter + 一份配置。

| 能力 | 当前在用 | adapter | 状态 |
|---|---|---|---|
| 文本 | 豆包 `doubao-seed-2-1-turbo-260628` | `doubao` | ✅ 51s |
| 生图 | 豆包 `doubao-seedream-4-0-20260415` | `doubao-image` | ✅ 12s，1080×1920 无水印 |
| 视频 | 方舟 Seedance 1.0 lite | `doubao-seedance` | ✅ 24s，480×864 |
| 配音 | 豆包语音 v1 协议 | `doubao-tts` | ✅ 4 个 uranus 音色可用 |
| 配音(备) | Windows SAPI | `windows-tts` | ✅ 离线免费，音色硬 |
| 视频(备) | 阿里 DashScope | `dashscope-video` | 欠费未验 |

**踩过的坑，别重犯：**

1. **模型名必须带日期后缀**。`doubao-seed-2-1-turbo` 这种裸名一律 404。正确做法：`GET /api/v3/models` 拉真实 ID。
2. **`ModelNotOpen` ≠ key 无效**。是账号已认证但没在控制台「开通管理」点开通，逐个模型点。
3. **Seedance 2.x 要余额 >200 元**才能调；1.0 / 语言 / 图片无门槛。免费额度是 200 万 tokens（视频）+200 张（图）。
4. **多图必须标 role**。方舟收到 ≥2 张图时，每张要带 `first_frame` / `last_frame` / `reference_image`，否则整单 400 `role must be specified`。单图不能带 role。
5. **1.0 系列不支持首尾接片**（`flf2v does not support`），被拒后要自动退回只发首帧。
6. **豆包语音两套协议**。v3 的 `X-Api-*` 头恒 403 `45000030 resource not granted`；v1 `/api/v1/tts` 可用，鉴权头是 `Authorization: Bearer;{token}`——**分号**，不是空格。App ID 是纯数字那串，UUID 那串不是。
7. **生图带 AI 水印**。请求体要显式 `watermark: false`。

---

## 7. 渲染管线（ffmpeg）

`packages/media/src/timeline.ts: buildRenderPlan()` 生成滤镜图，一条命令跑完：

```
每镜: trim(in/out) → setpts(变速) → scale+pad(统一 1080×1920) → fps=30 → fade(可选)
      ↓ concat 全部
字幕: subtitles='x.srt'  (burnSubs=true 才烧；否则软封装 mov_text)
音频: 视频自带音轨(volume>0 才取) + audio 轨(adelay 对齐) → amix normalize=0
```

要点：

- 画布固定 **1080×1920 / 30fps**，竖屏；横向素材靠 `pad` 补黑边，不裁。
- `video` 轨片段的 `volume` 默认 **0**（豆包视频无声），人声全在独立 `audio` 轨。
- `transition: "fade"` 才加淡入淡出，`transitionMs` 默认 400，且不超过片段时长一半。

---

## 8. 实测基线（火山方舟免费额度，2026-11-05）

| 项 | 数据 |
|---|---|
| 5 集 15 镜剧本生成 | 51s |
| 定妆图 | 12s/张，1080×1920 |
| 单镜视频 | 24s，5s / 480×864 |
| 单集成片 | 15s / 1080×1920 / h264+aac，字幕烧入 |
| 全流程额度 | 120s 视频 ≈ 57.6% 的 200 万 tokens |
| 成片验证 | ffprobe 查流 + ASR 回读音轨逐句比对字幕（全对） |

验证成片不要只看"有文件"，要 `ffprobe` 查流 + 抽帧看画面 + ASR 回读音轨对字幕。

---

## 9. 已知问题（按严重度）

### P0 · 成片"像 PPT"

实测第 1、2 集都是 3 镜 × 5s 等长硬切，观感接近幻灯片。六个可定位的成因：

1. **运镜默认静止**：`inferCameraMove()` 兜底返回 `"static"`，没写运镜的镜全被标"固定机位"，提示词里明确要求"别动"，模型就真不动。
2. **画面写的是状态不是过程**：`imagePrompt: "小女孩站在门口看向陈默"` 是定格描述，没有起止动作（"伸手→接住→收手"），模型只能生成"会呼吸的图"。
3. **每镜等长 5s**：节奏均匀即翻页感。真实短剧是 2s 反应镜 + 5s 情绪镜混剪。
4. **硬切到底**：全片 `transition` 为 `undefined`，`fadeFilter` 从未被触发。
5. **静帧兜底铺满时长**：视频生成失败时走 `isStill` 分支 `trim=duration`，一张图铺 5 秒 = 纯 PPT 页。
6. **字幕整段常驻**：一句铺满 5s、无渐显；静音段没有音效/BGM 垫底，观感更空。

### P1 · 其他

- **配角定妆不稳**：小女孩从红裙漂成粉袄扎辫子，主角稳定、配角约束弱。
- **Seedance 1.0 不对口型**：嘴不动，声音走独立音轨。要真对口型需可灵或 Seedance 2.0（余额门槛）。
- **质检不过会重做一次**：等于该镜多烧一遍视频额度，无上限控制。
- **`autoDub` 参数是前端标记**，视频接口不消费；配音必须显式走 `/api/gen/tts` 或 timeline finish。
- **旧项目 `bible.shots[]` 没有 `line` 字段**，一健成片会出现"有画面无配音"，不是 bug 是数据陈旧。

---

## 10. 改动指南

- 改提示词 → `packages/pipeline/src/script.ts`（系统提示常量）、`shotLang.ts`（镜头语言）
- 改生成逻辑 → `apps/server/src/services/episode.ts`（唯一主循环，别在路由里写业务）
- 加模型 → `packages/models/src/<name>.ts` 实现 adapter → `register.ts` 注册 → 加一条 endpoint
- 改渲染 → `packages/media/src/timeline.ts` 的 `buildRenderPlan`
- **改完 `packages/*` 必须重启 dev 进程**
