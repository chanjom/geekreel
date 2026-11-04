# 独立部署指南

这份文档回答一个问题：**把这套工具装到你自己的机器上，需要什么，坑在哪。**

先说结论——它不依赖任何服务器。没有账号系统、没有云数据库、没有订阅计费、没有作者的后端。一台电脑 + Bun 就是全部。所有数据存在你自己的硬盘上，所有 AI 能力由你自己申请的密钥驱动。

---

## 一、硬性条件

| 条件 | 说明 | 必须 |
| --- | --- | --- |
| [Bun](https://bun.sh) 1.2+ | 服务端直接调 `bun:sqlite`、`Bun.serve`、`Bun.spawn`，**Node 跑不了** | 是 |
| 磁盘空间 | 依赖约 400MB，视频产出另算 | 是 |
| ffmpeg / ffprobe | 由 `ffmpeg-static` 依赖自带，不用另装 | 否（自带） |
| yt-dlp | `bun install` 的 postinstall 自动下载当前平台版本 | 否（自动） |
| 模型 API 密钥 | 按需，见第五节 | 否（只玩雷达可以一个都不要） |

装 Bun：

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"
```

装完重开终端，`bun -v` 应输出 `1.2.x` 或更高。

---

## 二、拿到代码

```bash
git clone https://github.com/chanjom/geekreel.git
cd geekreel
bun install
```

`bun install` 做三件事：装依赖、按当前平台下载 yt-dlp 到 `packages/analyze/vendor/`、给 ffmpeg 二进制置可执行位。

> 仓库根目录的 `bunfig.toml` 已把 linker 固定为 `hoisted`。不要手动改成 isolated —— 见第八节第一个坑。

---

## 三、起服务

### 开发态（改代码即时生效）

```bash
./scripts/dev.sh          # macOS / Linux
scripts\dev.cmd           # Windows
```

- 网页：http://127.0.0.1:5473
- API / WebSocket：http://127.0.0.1:4780
- Vite 会代理 `/api` 和 `/ws` 到 4780

### 成品态（先编网页，再由服务托管）

```bash
./scripts/start.sh        # macOS / Linux
scripts\start.cmd         # Windows
```

浏览器只开一个地址：http://127.0.0.1:4780

两个脚本都会先跑 `bun install`，所以换机器直接跑脚本即可，不用记安装命令。

### 端口与路径

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VW_HOST` | `127.0.0.1` | 监听地址，改成 `0.0.0.0` 才允许局域网访问 |
| `VW_PORT` | `4780` | API 与成品网页端口 |
| `VW_DATA_DIR` | `~/.video-workbench` | 数据库与密钥存放目录 |
| `VW_FFMPEG` | 内置二进制 | 指定自己的 ffmpeg 路径 |

Windows 上 `~` 即 `%USERPROFILE%`。

---

## 四、第一次打开

打开 http://127.0.0.1:4780，没有密钥时界面会引导你去配置，而不是甩一堆报错栈。按下面的优先级配：

1. **文本模型**——几乎所有功能都要它，先配这个
2. **图片 / 视频模型**——按你要做的内容配
3. **配音模型**——想做口播、旁白再配，可以后补

配置入口是左侧 **模型** 页，添加端点后可以点测试连通。

---

## 五、外部服务清单

代码里没有任何自建后端，所有 AI 能力都走第三方 API。**这些供应商只是预设模板，填谁、填几个都由你决定。**

### 文本模型（必配其一）

| 供应商 | 申请地址 | 备注 |
| --- | --- | --- |
| 智谱 GLM | open.bigmodel.cn | 有免费额度；雷达的联网检索走它的独立搜索接口 |
| DeepSeek | platform.deepseek.com | 便宜，纯文本 |
| 通义千问 | dashscope.aliyuncs.com | 文本／图像／视频／配音都能用一个 key 覆盖 |
| Kimi / 豆包 / MiniMax / 混元 / Gemini / OpenAI | 各自官网 | 有 key 就能加 |
| Ollama / LM Studio / 本地 OpenAI 兼容 | 本机 | 完全离线，不花钱 |

### 图像、视频、配音

预设里有通义万相、豆包生图、GPT Image、Flux、智谱 CogView、可灵、豆包 Seedance、Sora、MiniMax 海螺等。做竖屏短剧的常见组合是「通义千问 + 通义万相 + 通义配音」，一个平台一个 key 全搞定。

### 完全不需要密钥的部分

**热点雷达**直接抓各平台公开榜（微博、知乎、抖音、B 站、今日热榜），零模型调用、零费用。所以即使一个密钥都没配，雷达页也能跑出真实数据。

### 推送渠道

支持 Bark（`api.day.app`）和自定义 webhook，都在订阅设置里填。

---

## 六、数据在哪

| 路径 | 内容 |
| --- | --- |
| `~/.video-workbench/vw.db` | SQLite：项目、任务、模型端点（密钥加密存储）、雷达条目、风格包索引 |
| `~/.video-workbench/` 其余文件 | 雷达缓存、导出中间产物 |
| `~/VideoWorkbench/` | 默认资产库（设置里可改，改动时可选迁移） |
| `<项目目录>/` | `project.vw.json`、画布快照、流水线状态、`export/` 成片 |

**备份就是拷这两个目录**。密钥在数据库里是加密的，换机器拷过去仍然可用。

---

## 七、换机器

```bash
# 新机器上
git clone https://github.com/chanjom/geekreel.git
cd geekreel
bun install
./scripts/start.sh
```

然后把旧机器的 `~/.video-workbench` 和 `~/VideoWorkbench` 覆盖过来，所有项目、历史、密钥原样还在。

如果不用默认路径，设 `VW_DATA_DIR` 指向你放数据的地方即可。

---

## 八、已知的坑

### 1. vite / tsc 报找不到 `picomatch`

**症状**：`bun run dev` 起来后前端编译失败，报 `Cannot find package 'picomatch'`。

**原因**：Bun 在 monorepo 下默认用 isolated 链接，被提升到子包 `node_modules` 里的传递依赖，bundler 看不见。

**处理**：仓库已带 `bunfig.toml` 固定 `linker = "hoisted"`。如果仍然报错，先 `rm -rf node_modules && bun install`。不要用 `--linker isolated`。

### 2. ffmpeg 报 `spawn EFTYPE` 或 `Exec format error`

**症状**：首次使用剪辑／合成时立刻失败，提示无法执行。

**原因**：`ffmpeg-static` 下载被网络截断（正常约 82MB，坏包往往只有 59MB 左右）。

**处理**：删掉坏的二进制再重装：

```bash
rm -rf node_modules/ffmpeg-static
bun install
```

启动时会实跑 `ffmpeg -version` 校验，坏包会自动回退到系统 PATH 里的 ffmpeg。想彻底绕开就自己装一个，用 `VW_FFMPEG` 指过去。

### 3. `git push` 卡在认证、或报 `User cancelled dialog`

**症状**：Git Credential Manager 弹窗转圈很久，或反复弹窗。

**原因**：不是你的操作问题。`github.com` 主站在部分网络环境下单次响应要十几秒，而 OAuth 登录要连续发十几次请求。

**处理**：改用 Personal Access Token，绕开 OAuth 交互：

1. 打开 https://github.com/settings/tokens/new?scopes=repo ，勾 `repo`，选 7 天有效期，生成
2. 推送时临时带上 token：

```bash
git remote set-url origin https://x-access-token:<你的token>@github.com/chanjom/geekreel.git
git -c credential.helper= push -u origin main
git remote set-url origin https://github.com/chanjom/geekreel.git
```

第三行必须执行，把 token 从配置里抹掉。推完记得去 GitHub 删掉这个 token。

### 4. 端口被占用

`EADDRINUSE` 时换端口：

```bash
VW_PORT=4880 ./scripts/dev.sh     # macOS / Linux
set VW_PORT=4880 && scripts\dev.cmd   # Windows cmd
$env:VW_PORT=4880; scripts\dev.cmd    # Windows PowerShell
```

### 5. 局域网访问打不开

默认只监听 `127.0.0.1`。要手机或其他机器访问，设 `VW_HOST=0.0.0.0`，并注意这台机器没有对外认证，**不要暴露到公网**。

---

## 九、装完自检

按顺序过一遍，全绿就说明环境没问题：

| 检查项 | 期望结果 |
| --- | --- |
| `bun -v` | 显示 `1.2` 或更高 |
| `bun install` | 结束无 error，`packages/analyze/vendor/` 下有 yt-dlp |
| `bun run typecheck` | 无类型错误 |
| 打开 http://127.0.0.1:4780 | 首页正常渲染，不是白屏 |
| **模型** 页测试文本端点 | 返回内容，不是 401 |
| **热点雷达** 页点「全部刷新」 | 四个平台出现真实条目（不需要密钥） |
| 随便建个项目点「分析」 | 任务进入队列并完成 |

---

## 十、这套东西的边界

说清楚免得踩坑：

- **单机自托管**，没有多用户、没有权限体系，一个人用。要给别人用得自己加反向代理和认证。
- **热度值是折算值**，同一平台内可比，跨平台不可比。
- **小红书没有公开榜**，雷达抓不到就是抓不到，界面会明示为空，不会编数据。
- **模型密钥加密存在本地 SQLite 里**，不经过任何第三方服务器，但也意味着数据库文件泄露等于密钥泄露，别把它传到公开仓库。
