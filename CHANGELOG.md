# 更新说明

功能以本仓库实现为准。设置页显示的版本号来自服务端。

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
