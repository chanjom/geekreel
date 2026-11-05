# 把它变成你自己的

三种情况，选一种：

| 你想 | 跳到 |
|---|---|
| 只是想改个名字、换个 logo，自己用 | [A](#a-只改名字和-logo) |
| 想放在自己的 GitHub 上，当自己的项目维护 | [B](#b-变成自己的仓库) |
| 想改成完全不同的产品（删功能、加功能、换 UI） | [C](#c-改代码) |

许可证是 **Unlicense**：可以改名、闭源、商用、再发布，不用标注原作者，不用开源你的改动。唯一的约束来自你引入的第三方依赖，它们各自的许可证要看一眼（见 [E](#e-许可证要说清楚的地方)）。

---

## A. 只改名字和 logo

**不用改代码。** 仓库根建一个 `.env`：

```ini
VW_SITE_NAME=你的产品名
```

重启，登录页、邮件标题、浏览器标题都会变。这是最省事的方式，升级时也不会冲突。

想再换 logo，替换这两个文件（同名覆盖）：

- `apps/web/public/logo.jpg` —— 界面上所有位置都用它
- `apps/web/index.html` 里的 `<title>` 和 favicon（如果换格式）

改完 `bun run build` 重新编译（Docker 部署就 `docker compose up -d --build`）。

---

## B. 变成自己的仓库

### B-1. 在 GitHub 上 Fork（保留上游关系，能同步更新）

1. 打开仓库页面，右上角 **Fork** → 选你的账号
2. 到你的 fork 页面，点 **Code** 复制地址
3. 本地：

```bash
git clone https://github.com/你的用户名/geekreel.git
cd geekreel
git remote add upstream https://github.com/chanjom/geekreel.git

# 以后想同步原作者的更新：
git fetch upstream
git merge upstream/main        # 有冲突就按提示改
```

Fork 的好处是能持续吃上游更新；坏处是别人一看就知道你 fork 自谁。

### B-2. 直接拿来当自己的（断开关系，推荐做产品）

```bash
# 1. 下载一份，不要 .git 历史
git clone --depth 1 https://github.com/chanjom/geekreel.git my-product
cd my-product
rm -rf .git

# 2. 重新初始化成自己的仓库
git init -b main
git add -A
git commit -m "初始化：基于 GeekReel 的自有版本"

# 3. 推到自己的远端（先在 GitHub 建一个空仓库）
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```

命令行不熟就用网页版：下载 ZIP → 解压 → 在 GitHub 网页新建仓库 → 上传文件。

### B-3. 检查有没有把不该传的东西传上去

```bash
git status --short          # 只应该有源码改动
du -sh .git                 # 超过 100MB 就要小心
```

`.gitignore` 已经排除了 `node_modules/`、`dist/`、`.env`、`*.db`、`.secret`。**千万别把 `.env` 和数据库提交上去** —— 里面有加密密钥和模型 key。

如果已经误传了：

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "移除误提交的配置"
```

> 已经推到公开仓库的 key，**立刻去厂商后台吊销重发**。删提交没用，历史里还在。

---

## C. 改代码

### C-1. 先搞清楚东西在哪

```
apps/web/            前端（React 19 + Vite + Tailwind v4）
  src/pages/         每个菜单一个文件，改界面基本只动这里
  src/components/    共用组件（layout 侧栏、authShell 登录外壳）
  src/lib/           api 封装、i18n、状态
  public/logo.jpg    品牌图

apps/server/         后端（Bun + Hono + SQLite）
  src/routes/        每个 /api 前缀一个文件
  src/services/      业务逻辑（生成、渲染、雷达、分析）
  src/jobs/queue.ts  任务队列
  src/db.ts          建表 + 迁移
  src/config.ts      所有环境变量入口

packages/            共享包
  models/            各家模型适配器（要接新厂商改这里）
  pipeline/          剧本 → 定妆 → 分镜 → 出片
  media/             ffmpeg 封装
  radar/ analyze/ remake/ style/ push/
```

更细的数据流、接口表、模型适配的坑：见 [WORKFLOW.md](WORKFLOW.md)。

### C-2. 常见的几个改法

**加一个模型厂商**

1. `packages/models/src/` 里照现有适配器写一个（OpenAI 兼容的最简单，照抄 deepseek）
2. 在 `packages/models/src/register.ts` 注册
3. 前端「模型」页的预置列表会自动出现

**改首页文案 / 引导语**

`apps/web/src/pages/homePage.tsx`

**改登录页左侧那句大标题**

`apps/web/src/components/authShell.tsx` 里的 `MarketingPanel`。文案、卖点、流程条都在这里，改完刷新就生效。

**加一个菜单**

1. `apps/web/src/pages/` 新建页面
2. `apps/web/src/app.tsx` 加 `<Route>`
3. `apps/web/src/components/layout.tsx` 的 `navItems` 加一行
4. `apps/web/src/lib/i18n.ts` 的 `zh.nav` 和 `en.nav` 各加一个 key（**两个都要加**，否则英文界面会报类型错）

**改主题色**

`apps/web/src/index.css` 顶部 `@theme` 里的 `--color-accent` 一行改掉，全站按钮、高亮、进度条一起变。

### C-3. 改完必须做的三件事

```bash
bun run typecheck                       # 类型有没有炸
bun test                                # 单测（191 个，别改坏了）
bun run build                           # 前端能不能编译
```

---

## D. 自己发布

### D-1. 打自己的镜像

```bash
docker build -t 你的dockerhub名/geekreel:0.2.0 .
docker push 你的dockerhub名/geekreel:0.2.0
```

别人就不用 clone 代码了，直接：

```yaml
# docker-compose.yml
services:
  geekreel:
    image: 你的dockerhub名/geekreel:0.2.0
    ports: ["127.0.0.1:4780:4780"]
    environment:
      VW_MULTI_USER: "1"
      VW_ALLOW_REGISTER: "1"
      VW_SITE_NAME: "你的产品名"
    volumes:
      - ./data:/data
      - ./library:/library
```

`docker compose up -d` 就跑起来了。

### D-2. 发版前自查

```
[ ] .env 没提交，仓库里搜不到任何 sk- / 密钥
[ ] docker build 从零能成功（不是靠本地 node_modules）
[ ] 空数据目录启动一次：能注册、能登录、能建项目
[ ] 换台机器 docker run 一次：数据卷挂上去，历史项目还在
[ ] README 里的截图和实际界面对得上
[ ] LICENSE 换成了你想要的（或保留 Unlicense）
```

---

## E. 许可证要说清楚的地方

本仓库是 **Unlicense**（公有领域），你不需要做任何事就能商用、闭源、改名。

但依赖不是：

| 依赖 | 许可 | 商用要注意 |
|---|---|---|
| ffmpeg（系统包 / 项目依赖） | LGPL / GPL（看编译选项） | 静态链接 GPL 版本会有传染性；用系统包一般没事 |
| yt-dlp | Unlicense | 随便用 |
| React / Vite / Tailwind / Hono | MIT | 保留版权声明即可 |
| 内置字体与截图素材 | 见各自文件 | 商用前确认字体授权 |

另外：**风格包**（上美影风等）里的提示词是文本，可以商用；但「上美影」是上海美术电影制片厂的品牌，别拿它做产品名或宣传语。

---

## F. 改了之后怎么让别人也能用

你 fork 出去以后，「给别人用」的流程完全一样，只是仓库地址换成你自己的：

- 部署：[SELF-HOST.md](SELF-HOST.md)，`git clone` 换成你的地址
- 新人教程：[TUTORIAL.md](TUTORIAL.md)，可以整份复制到你的文档站
- 一键脚本：`scripts/setup.sh` / `setup.cmd` 不用改，跟随代码走

如果改了品牌，记得把这三处的名字一起改掉，否则用户会看到混着的两个名字：

1. `.env` 的 `VW_SITE_NAME`
2. `apps/web/index.html` 的 `<title>`
3. `README.md` 第一行的标题

---

## 附：你可能会想删的功能

| 想删 | 怎么删 |
|---|---|
| 热点雷达 | `apps/server/src/app.ts` 去掉 `radarRoutes`；`layout.tsx` 去掉菜单项 |
| 竞品分析 | 同上，去掉 `analyzeRoutes` 和菜单 |
| 连载 | 去掉 `seriesRoutes`、`/series` 路由和菜单 |
| 画布 | 去掉 `canvasRoutes`、`/canvas` 路由和菜单 |
| 注册功能 | `.env` 里 `VW_ALLOW_REGISTER=0`，只留管理员开号 |
| 整个账号体系 | `VW_MULTI_USER=0`，回到单机模式（本机即管理员） |

删接口时注意：前端有对应的查询 key，删了会 404 并在控制台报错，把页面一起删掉才干净。
