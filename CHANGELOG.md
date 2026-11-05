# 更新说明

功能以本仓库实现为准。设置页显示的版本号来自服务端。

## 0.3.0 · 2026-11-05

加了一个"导演"：你说一句想拍什么，它拆方案、认人物、排分集、出第 1 集、合成，每个岔口停下来问你。不满意就回一句，它只改这一点，不重跑整部。

### 导演模式（`/director`）

- **五个闸口**：`plan`（方案）→ `bible`（人物）→ `cast`（分集）→ `shots`（第 1 集）→ `render`（合成）。每一步 `status="waiting"` 等你点，不确认不动。
- **不重写引擎**：每阶段只是把已有任务丢进队列 —— `pipeline.run`（带 `checkpoint`）、`advancePipeline`、`pipeline.episode`、`timeline.render`。状态靠查 `jobs` 表推进，没有常驻进程，重启不丢。
- **一句话修改**：`plan` 阶段重生成方案（在原方案基础上改）；`bible` 阶段点名某个角色就**只改那一个、只重画他的图**，没点名就改整份且保留已有定妆图；`shots` 阶段重出第 1 集。
- **预算护栏**：开工时设上限，每次花钱前 `assertBudget` 拦一道。端点没填单价时按公开价兜底估算（图 0.25/张、视频 0.12/秒、TTS 0.02/千字），金额前显示 `≈` 表示是估的。花费每次查询实时重算。
- **失败只退一步**：`retryAgent` 重提当前阶段的任务，不从头跑。
- **不糊弄的成功**：视频模型没开通时，`pipeline.episode` 会逐镜退回静帧，合成出来像 PPT。出片卡片在 `videoCount === 0` 时亮红色警告，附上每个镜头的报错。
- **页面**：左侧拍过的（标题 + 状态 + 花费）、右侧阶段进度条 + 阶段卡片 + 操作区；当前看哪一条记在地址里（`/director?id=…`），刷新不丢。
- **新表** `agent_runs`；接口 `GET /api/agent`、`POST /api/agent/start`、`GET /api/agent/:id`、`POST /api/agent/:id/{confirm,retry,abort}`。文档见 `docs/AGENT.md`。

### 顺手修的

- **集数不再写死 5 集**：`pipeline.run` 接受 `episodeCount`，方案说几集就几集（原来无论方案怎么写都拆 5 集）。
- **出片结果能看见失败**：`pipeline.episode` 新增回报 `videoCount` / `videoFailed` / `videoErrors`，上层能分辨"真出片"和"全是图"。
- **点名改角色不再丢图**：`parseBibleRevise` 按名字兜底保留原定妆图。

### 已知限制

- `cast` 阶段改不了角色：流水线此时已锁定，硬改要回滚状态或重建画布，风险大于收益。页面如实说明并提供两条出路（去画布手改 / 停在这里重开）。
- `shots` 只出第 1 集，其余集在画布与时间线里逐集跑。

## 0.2.0 · 2026-11-05

把「别人能直接用」这件事补完：账号闭环（注册 / 登录 / 忘记密码 / 验证邮箱 / 管理员后台）、仿主流的登录页、一键安装脚本、四份交付文档。多人部署不再是「能跑」，是「敢发给别人」。

### 账号体系

- **忘记密码**：`POST /api/auth/forgot` 生成一次性令牌（1 小时、只能用一次、存哈希不存原文），配了 SMTP 直接发信；没配就落盘到 `data/outbox/` 并打印到日志。重置成功后**踢掉该用户所有旧会话**。
- **邮箱验证**（可选）：`VW_REQUIRE_EMAIL_VERIFY=1` 后注册必须先点邮件里的链接。只在配好 SMTP 时才生效 —— 否则注册完会直接卡死。
- **管理员后台** `/admin`：账号列表、直接开号、停用/启用、改角色、生成重置链接、30 天用量汇总。禁止停用/降级自己，也禁止把站里最后一个管理员弄没；有项目的账号不允许直接删。
- **登录页重做**：左右分栏（左侧产品说明 + 流程条，右侧表单），登录/注册切换、显示密码、密码强度条、记住邮箱、条款勾选、`?mode=register` 直达注册、首管理员引导。
- **配套页面**：`/forgot`、`/reset`、`/verify`、`/terms`、`/privacy`。条款与隐私是这一份部署自己的规则，管理员可改写。
- **密码规则前后端统一**：至少 8 位、挡掉常见弱密码、不允许单一字符。`checkPassword()` 同时被注册、重置、改密、管理员开号使用。
- **接口错误带业务码**：`code: exists | terms | code | unverified | disabled | expired`，前端据此给出不同处理（例如已注册自动切到登录态）。

### 交付与部署

- **一键安装**：`scripts/setup.sh` / `scripts/setup.cmd`。检查 Bun、装依赖、编网页、启动；`setup.sh multi` 会顺手生成 `.env`（开放注册 + 随机邀请码 + 监听所有网卡）并打印邀请码。
- **自动读 `.env`**：服务启动时读取仓库根的 `.env`，不用记 `export`，从任何目录启动都生效；真实环境变量优先，容器注入不被覆盖。
- **启动自检**：启动时打印多人模式、注册策略、发信状态、首个管理员提示；监听 `0.0.0.0` 但没开多人模式会明确警告。
- **文档**：`docs/START-HERE.md`（三种人三条路）、`docs/TUTORIAL.md`（零基础实操）、`docs/SELF-HOST.md`（服务器部署全流程 + 合规）、`docs/FORK.md`（换品牌、推自己的仓库、打镜像）。`.env.example` 每项都有注释。

### 改成你自己的

- **`scripts/rebrand.sh` / `rebrand.cmd`**：一条命令改产品名、副标题、主题色、logo、包名。主题色会自动算出深/浅/护眼三套主题的 accent 与 accent-dim；`--reset-git` 直接断开与原仓库的关系。
- **品牌不再是硬编码**：站点名与副标题由 `/api/auth/config` 下发，侧栏、登录页、浏览器标题、邮件标题共用一处配置。改 `.env` 里的 `VW_SITE_NAME` / `VW_SITE_TAGLINE` 重启即可，不用重编前端。
- 新增 `VW_SITE_TAGLINE`（品牌名下面那行小字，留空则不显示）；`apps/web/src/lib/site.ts` 存构建期默认值，兜底接口未返回时显示。
- `docs/FORK.md` 重写：三种目标分流、换牌参数表、改了不生效的六步排查、断上游、打镜像、许可证。

### 其他

- 版本号 `0.1.2` → `0.2.0`；`VW_SITE_NAME` 可改站点名，`VW_LIBRARY_ROOT` 可指定资产库根目录。
- 服务器启动时清理过期令牌与会话。

### 升级注意

- 数据库自动加 `users.emailVerified` 列（历史账号默认为已验证）和 `auth_tokens` 表，不影响已有数据。
- 老部署只需 `git pull` 后重启；开了多人模式的，建议先备份 `/data`。

---

## 0.1.2 · 2026-11-04

热点雷达从「模型猜」换成「真的榜」：四个主流平台直连实时榜，模型只在需要语义判断的地方出现。顺手修掉出片链路上几个会让整条流程白跑的问题。

### 热点雷达

- **直连实时榜**：微博 / 知乎 / 抖音 / B 站走公开榜单，不调模型、零费用、几秒出结果。卡片给的是真实排名和原始热度（「微博热搜 #3 · 161 万」），「原文」直达那条视频或问答，不再是站内搜索。
- **模型不再编热点**：智谱要先用独立检索接口取回网页片段，再连同问题一起喂给模型——原来的 `enable_search` 它不认，等于没有联网。检索词单独取，上下文按发布日期裁旧；翻不到当天内容时，模型必须直说「没查到」，而不是拿去年旧闻充数。
- **搜索两种行为分开**：输入即时筛本地，回车才联网现查，搜完只列本次新增。
- **订阅与推送有了入口**：关键词 + 平台多选 + 热度阈值，推 Webhook / Server酱 / Telegram / Bark / 邮件，可发测试消息；每日早报可设时间。这套后端早就有，之前前端没门。
- **并发刷新**：页签上实时显示哪个平台在抓、进度几比几；某个端点 key 失效会自动换下一个，不再一条报错拖垮整页。
- **查不到就说查不到**：小红书没有公开榜，页签保留但明说抓不到，不编数据。

### 稳定性

- **智谱默认关掉「深度思考」**：推理 token 和正文抢同一份输出预算，长 JSON 会被截断。和之前 Agnes 4096 截断是同一个坑。
- **ffmpeg 探测改成实跑**：`-version` 能跑才算可用，坏掉的静态包自动退回 PATH，不会让整条出片链在第一步就失败。
- **分镜不再纯色背景**：场景提示词要求环境铺满画幅（新增 `hard-constraint-scene`），不再因为「大面积留白」把镜头画成一片空白。
- **动物毛色锁死**：毛色写进人物档案，注入时再兜一层，老虎不会跨镜从橘黄变灰黑。

### 使用注意

- 仓库不再携带 yt-dlp 二进制（各平台共约 60MB）。第一次做竞品分析时程序会自己下载到 `packages/analyze/vendor/`。
- 微博 / 知乎 / 抖音 / B 站 不需要模型；小红书需要带联网检索的文本端点，且经常查不到。

---

## 0.1.1 · 2026-10-07

短剧出片更像一条完整生产线：人物场景可复用，声音不只人声，对白按成片对嘴，不再把整份剧本灌进一条短视频。

### 成片与配音

- **按成片写词**：配音只念这一镜画面里的事，5 秒片子不会配出 30 秒旁白。
- **对白先配音再对嘴**：角色开口的镜头用 TTS 驱动可灵 / 万相对口型；旁白和空镜只铺声。
- **音轨铺满**：配乐、环境底、音效可上时间线；人声段落自动压低配乐；可导出剪映草稿。

### 资产与镜头

- **角色 / 场景 / 道具是可复用资产**：定妆支持多视图，出片按名字对上资产库。
- **镜头语言**：景别、运镜、机位写进分镜，不再只丢一句画面说明。
- **质检闭环**：对照生成结果看漂脸换装，没过只重做这一镜。
- **多参考图**：万相 / Sora / 可灵按模型能力带上首帧、尾帧和主体库，不把不支持的字段硬塞给旧模型。

### 使用注意

- 配音仍要在时间线里选音色再点，不会在出片时擅自铺上。
- 对口型依赖视频模型。对不上时保留原视频并铺声，界面会说明。

---

# Changelog

## 0.1.2 · 2026-11-04

The radar reads real boards instead of guessing: four platforms are wired to public realtime lists, and the model is only used where semantics are actually needed.

- **Direct realtime boards** for Weibo / Zhihu / Douyin / Bilibili: no model call, no cost, results in seconds, with the platform's own rank and hot value. "Source" opens the real post or video instead of a site search.
- **Zhipu needs its standalone search endpoint.** `enable_search` was silently ignored, so no result was ever injected and the model improvised from memory. Search terms are now sent separately, stale hits are dropped by publish date, and when nothing recent is found the model has to say so.
- Typing filters locally; Enter asks the model to search, and the result panel shows only what is new this round.
- **Subscriptions and push finally have a UI**: keyword + platforms + heat threshold, to Webhook / ServerChan / Telegram / Bark / email, with a test button, plus a daily digest time.
- Concurrent refresh shows per-platform progress. A dead endpoint key falls through to the next candidate instead of failing the whole page.
- Xiaohongshu has no public board; the tab says so rather than inventing data.
- Zhipu's deep-thinking mode is off by default — reasoning tokens starved long JSON output, the same failure class as the earlier truncation.
- ffmpeg detection runs `-version` for real; a broken static build falls back to PATH instead of failing the first step of rendering.
- Scene prompts must fill the frame with an environment, and animal fur colors are locked into the character bible.

The repo no longer ships the yt-dlp binaries (~60MB); the app downloads them into `packages/analyze/vendor/` on first use.

---

## 0.1.1 · 2026-10-07

Short-drama finish is a full pass: reusable looks, more than TTS, dialogue driven from the clip, lips synced from speech.

- Dubbing writes lines from the generated clip; a 5s shot is not filled with a 30s script.
- Talking shots: TTS first, then Kling / Wan lip-sync. Narration and empty shots only lay audio.
- BGM, ambience, and SFX on the timeline; duck BGM under speech; Jianying draft export.
- Characters / scenes / props are library assets with multi-view looks.
- Shot size, move, and angle land on each beat. QA retries a drifted shot only.
- Extra reference images are sent only to models that accept them.

Dubbing stays opt-in on the timeline. If lip-sync fails, the original video stays and a note is shown.
