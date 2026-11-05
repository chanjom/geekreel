# 导演模式（短剧 Agent）

一句话进去，一部片子出来，中间停下来等你。

它不是一个新引擎，是把仓库里已有的流水线按顺序串起来，每一步把决定权还给你：

```
说一句  →  方案  →  人物  →  分集  →  第 1 集  →  合成  →  成片
           ↑       ↑       ↑        ↑
         停下来   停下来   停下来    停下来        每一步都能说一句"改成这样"
```

页面：左侧菜单「导演模式」，地址 `/director`。选中哪一条会记在地址里（`/director?id=…`），刷新不丢、也能直接发给别人看。

---

## 1. 它复用了什么

没有一行是重写的。每个阶段就是把一个已有任务丢进队列，然后等它跑完：

| 阶段 | 实际干活的 | 产物 |
|---|---|---|
| `plan` | 直接调文本模型（`chatMetered`），不走队列 | 结构化方案：剧名 / 故事 / 集数 / 时长 / 风格包 |
| `bible` | `pipeline.run`（`checkpoint: true`） | 人物档案 + 定妆图 + 分集 |
| `cast` | `advancePipeline` | 定妆补画 + 每集分镜 |
| `shots` | `pipeline.episode`（`episodeIndex: 1`） | 第 1 集的镜头素材 |
| `render` | `timeline.render`（`burnSubs: true`） | 烧好字幕的 MP4 |

`pipeline.run` 的 `checkpoint` 是这套东西的基础：它跑到人物出来就停住，`status="waiting"`，等人点确认才继续。导演模式只是把这根"暂停线"接成了五个闸口。

---

## 2. 状态机

两个维度：`stage` 走到哪一步，`status` 这一步什么情况。

```
stage:  plan → bible → cast → shots → render → done
status: running（在跑） / waiting（等你） / done / failed / aborted
```

规则只有三条：

1. **只有 `waiting` 能确认。** 别的时候点确认会收到"还在跑，等这一步出来"。
2. **`running` 靠查任务表推进。** 每次 `GET /api/agent/:id` 都会去看 `jobs` 表里那个 jobId 好没好；好了就把结果写回 `stageJson`、`status` 翻成 `waiting`。没有定时器、没有常驻进程，重启服务器不丢状态。
3. **`failed` 只能重试当前这一步。** `retryAgent` 按 `stage` 重新提交同一个任务，不从头跑。

失败原因存在 `note` 里，前端直接显示。任务进度（`progress` / `message`）只透传，不落库。

---

## 3. 每一步能改什么

| 停在哪 | 说一句话会怎样 | 不想改就点 |
|---|---|---|
| `plan` | 重新生成整份方案（在原方案基础上改，不是推翻重来） | 开工 → 进 `bible` |
| `bible` | 提到某个角色名 → **只改那个角色**（会重画他的定妆图）；没提名字 → 改整份剧本（已有定妆图保留） | 确认人物 → 进 `cast` |
| `cast` | **不接受修改**（见下方"已知限制"） | 出第 1 集 → 进 `shots` |
| `shots` | 重新出第 1 集（换镜头、重新抽卡） | 合成 → 进 `render` |
| `render` | — | 自动完成 |

`bible` 阶段的分流逻辑就是一段 `includes`：

```ts
const hit = cast.find((c) => note.includes(c.name)) ?? cast.find((c) => c.id === input.targetId);
if (hit) await revisePipelineCast(row.pipelineId, { target: "character", targetId: hit.id, instruction: note });
else await revisePipelineBible(row.pipelineId, note);
```

为什么要点名才走"改一个人"：整份改写会重画全部定妆图，白花钱。

---

## 4. 钱

三件事：预算上限、实时花费、超了就停。

**预算**在开工时定（默认 `max(方案估算 × 2, 20)` 元），存 `agent_runs.budgetCents`。每次要花钱的动作前都过一遍 `assertBudget`：

```ts
if (row.budgetCents > 0 && spent >= row.budgetCents) throw new Error("已经花到预算上限了…");
```

**花费**从 `model_usage` 表汇总。问题是绝大多数人不会给端点填单价，`cost` 全是 0，护栏就等于没有。所以没填单价时按公开价兜底估：

| 能力 | 估算口径 |
|---|---|
| 图片 | 0.25 元 / 张 |
| 视频 | 0.12 元 / 秒 |
| TTS | 0.02 元 / 千字 |
| 文本 | 0.002 元 / 千 prompt + 0.008 元 / 千 completion |

只要有一条是估的，返回里 `spentEstimated: true`，前端在金额前显示 `≈`。这是"看得见的估"，不是偷偷算。

花费**每次查询都实时算**，不信库里存的 `spentCents`——那份只给列表页排序用，跑起来就过时了。

---

## 5. 接口

| 方法 | 路径 | 干什么 |
|---|---|---|
| `GET` | `/api/agent` | 我拍过的（最近 30 条） |
| `POST` | `/api/agent/start` | `{ brief, budgetYuan? }` → 出方案，`stage=plan, status=waiting` |
| `GET` | `/api/agent/:id` | 一条详情（顺手推进状态机、刷新花费） |
| `POST` | `/api/agent/:id/confirm` | `{ note?, targetId? }` → 确认 / 按这句话改 |
| `POST` | `/api/agent/:id/retry` | 失败后重试当前这一步 |
| `POST` | `/api/agent/:id/abort` | 停下（已花的钱不退） |

`status=waiting` 时前端每 2.5 秒轮询详情，`running` 时也会轮询以便看到进度；列表 15 秒刷一次。

---

## 6. 数据

一张表，`agent_runs`（`apps/server/src/db.ts`）：

```sql
id / ownerId / projectId / pipelineId / brief
status / stage
planJson    -- 结构化方案
stageJson   -- 当前阶段给前端看的摘要（人物、分集、出片结果、jobId）
budgetCents / spentCents
note        -- 失败原因 / 阶段提示
createdAt / updatedAt
```

`stageJson` 只放摘要，不放整份 bible——bible 可能有几万字，塞进去前端要背。

---

## 7. 加一个新阶段

比如想在"合成"之后加一步"配乐"：

1. `AgentStage` 加 `"music"`，插到 `render` 和 `done` 之间
2. `JOB_BY_STAGE` 不用改（它是给 `retryAgent` 用的，加一行 `music: "audio.music"`）
3. `refresh()` 里加一个分支：job done → 存结果 → `status: "waiting"`
4. `confirmAgent()` 里加一个分支：确认后提交下一个任务
5. 前端 `STEPS` 加一项，`renderCard()` 加一个 case

骨架不用动，五个阶段都是同一个形状。

---

## 8. 已知限制

**`cast` 阶段改不了角色。** `advancePipeline` 之后流水线状态已锁定，`revisePipelineBible` 会抛"现在不能改，先等这一步列完"。硬改要么回滚流水线状态、要么重建画布和连载，风险大于收益，所以这一版选择如实拒绝：要改角色去画布手改，要改集数就"停在这里"重开一部（在 `plan` 阶段改最省钱）。

**`shots` 只出第 1 集。** 剩下几集在画布/时间线里逐集跑。这是刻意的：第一集最贵、最能看出风格对不对，不该一口气把钱烧完。

**视频模型没开通会退化成静帧。** 豆包 Seedance 之类未开通时，`pipeline.episode` 的每个镜头都会退回图片，最终合成出来是"一张张图配字幕"，看起来像 PPT 但接口是成功的。`episode.ts` 因此额外回报 `videoCount` / `videoFailed` / `videoErrors`，出片卡片在 `videoCount === 0` 时显示红色警告，不让你拿这种片子去交付。

两种常见的"只剩静帧"：

| 报错 | 意思 | 怎么办 |
|---|---|---|
| `has not activated the model doubao-seedance-…` | 这个模型你根本没开通（火山方舟里要单独激活，同一个 key 不代表所有模型都能用） | 控制台激活该模型，或换一个已开通的 |
| `has reached the set usage limit … "Safe Experience Mode"` | 开通了，但走的是免费试用额度，额度用完了 | 关掉「安全体验模式」/ 充值 |

同一部片子里 `videoCount=2, videoFailed=1` 这种就是第二种：模型通、额度中途用完。此时成片能出，但有一镜是静的 —— 要补就整集重跑（换端点或充值后），单镜补不了。

**方案估算不等于真实账单。** `estimatedYuan` 是模型按每集 1.5 元随口估的，实际以 `model_usage` 汇总为准。
