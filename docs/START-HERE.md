# 从这里开始

先花 30 秒看清自己是哪一种人，然后只走那一条路。别的文档现在都不用看。

| 你是 | 你想要 | 走这条路 | 大概耗时 |
|---|---|---|---|
| **A. 我只想自己用** | 在自己电脑上做片子 | [下面 A](#a-我只想自己用) | 5 分钟 |
| **B. 我想给一群人用** | 同事 / 客户 / 朋友各用各的号 | [docs/SELF-HOST.md](SELF-HOST.md) | 40 分钟 |
| **C. 我想把它变成我的产品** | 换名字、换 logo、推我自己的仓库 | [docs/FORK.md](FORK.md) | 1 小时 |

第一次用这个工具、完全没接触过，先看 [docs/TUTORIAL.md](TUTORIAL.md)：从装环境到导出第一条成片，每一步都有命令和截图说明。

---

## A. 我只想自己用

### 第 1 步：装 Bun

Bun 是运行这个东西的环境，装一次就行。

**Windows**：开始菜单搜 `PowerShell`，打开，粘这一行回车：

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**macOS**：

```bash
curl -fsSL https://bun.sh/install | bash
```

**Linux**：同上。

装完**关掉终端重开一个**（很重要，否则找不到 `bun` 命令）。

检查一下：

```bash
bun --version
```

能打印出版本号（如 `1.4.4`）就成了。

### 第 2 步：拿到代码

```bash
git clone https://github.com/chanjom/geekreel.git
cd geekreel
```

没有 git？在 GitHub 页面点绿色 `Code` → `Download ZIP`，解压，然后进到那个文件夹。

### 第 3 步：一键跑起来

**Windows**：

```bat
scripts\setup.cmd
```

**macOS / Linux**：

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

第一次会装依赖、编译网页，等 1–3 分钟。看到这行就好了：

```
[vw] 视频工作台 server 已启动: http://127.0.0.1:4780
```

### 第 4 步：打开浏览器

访问 **http://127.0.0.1:4780**

不需要登录、不需要注册，直接进首页。

### 第 5 步：填一个模型 key

没有 key 什么也生成不了。到左边 **模型** 页 → 选一家（新手推荐 DeepSeek，便宜、中文好）→ 点一下 → 粘 key → 保存。

怎么拿 key：[TUTORIAL 第 3 节](TUTORIAL.md#3-配一个能用的模型key)。

### 关掉之后怎么再打开

```bash
# Windows
scripts\start.cmd
# macOS / Linux
./scripts/start.sh
```

`start` 不重新装依赖，只编译 + 启动，几秒钟。

### 你的东西放在哪

| 内容 | 位置 |
|---|---|
| 数据库、加密后的 key、雷达缓存 | `~/.video-workbench`（Windows：`%USERPROFILE%\.video-workbench`） |
| 素材、成片、项目目录 | `~/VideoWorkbench`（界面「设置」里可改） |

**备份 = 拷这两个文件夹**。换电脑就是「拷仓库 + 拷这两个文件夹」。

---

## B. 我想给一群人用

你要的是：一个网址，别人注册账号，各做各的片子，互相看不见。

完整步骤在 **[docs/SELF-HOST.md](SELF-HOST.md)**，含：服务器选型、域名与备案、HTTPS、邀请码、发信配置、备份、升级。

最短路径（有一台 Linux 服务器、装了 Docker）：

```bash
git clone https://github.com/chanjom/geekreel.git && cd geekreel
cp .env.example .env
# 编辑 .env：VW_MULTI_USER=1、VW_ALLOW_REGISTER=1、VW_REGISTER_CODE=你的邀请码
docker compose up -d --build
```

然后按 [SELF-HOST 第 3 节](SELF-HOST.md#3-配域名和-https) 配域名和证书。

**必须先想清楚的 3 件事**：

1. **服务器要 2 核 4G、磁盘 100G 起**。视频很占地方，50G 做不了几集。
2. **中国大陆服务器 + 域名对外服务要备案**，没备案 80/443 会被封。
3. **模型 key 谁出**：本站不代付。默认每人自己在「模型」页填自己的 key（你零成本）；也可以由你统一发 key，但账单在你身上。

---

## C. 我想把它变成我的产品

见 **[docs/FORK.md](FORK.md)**。核心三步：

1. 在 GitHub 上 Fork 到你自己的账号（或用 `git remote set-url` 换掉来源）
2. 改品牌：站点名、logo、标题、邮件模板、README
3. 推到你自己的仓库，想发布就 `docker build` 打镜像

许可证是 **Unlicense** —— 允许改名、闭源、商用、再发布，不需要保留原作者信息，也不需要开源你的改动。

---

## 卡住了先看这里

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `bun: command not found` | 装完没重开终端 | 关掉终端重新打开 |
| `端口被占用 (EADDRINUSE)` | 4780 被别的程序占了 | 在 `.env` 里写 `VW_PORT=4781` |
| 打开是空白页 / 404 | 忘了编译网页 | 跑 `bun run build` 再启动 |
| 页面能开，但生成报「未配置端点」 | 没填模型 key | 去「模型」页填一个 |
| 生成报 401 / 403 | key 错了或没额度 | 到服务商后台看余额和 key 权限 |
| 视频合成失败、没有声音 | ffmpeg 没找到 | 装 ffmpeg，或在 `.env` 里 `VW_FFMPEG=/路径/ffmpeg` |
| 别人打不开你的地址 | 只在监听本机 | `.env` 里 `VW_HOST=0.0.0.0`，并检查防火墙 |
| 忘记密码，邮件收不到 | 没配 SMTP | 让管理员在「账号管理」里生成重置链接发给你 |

还有问题：先看 [docs/WORKFLOW.md](WORKFLOW.md) 的「已知问题」一节，那里列了这个工具目前真实的边界，不粉饰。

---

## 文档地图

| 文件 | 讲什么 |
|---|---|
| `README.md` | 项目是什么、有什么功能、界面截图 |
| `docs/START-HERE.md` | **本页**：三种人三条路 |
| `docs/TUTORIAL.md` | 零基础实操：装环境 → 出第一条片子 |
| `docs/SELF-HOST.md` | 部署到服务器给别人用 |
| `docs/FORK.md` | 变成自己的仓库 / 自己的品牌 |
| `docs/WORKFLOW.md` | 内部链路、模块地图、模型适配的坑、渲染管线 |
| `docs/DEPLOY.md` | 老版本的单机部署与排错（仍有效） |
| `docs/design.md` | 架构设计文档 |
| `.env.example` | 所有配置项，每项都有注释 |
