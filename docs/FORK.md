# 把它变成你自己的

这个仓库是 **Unlicense**（公有领域）。你可以改名、闭源、卖钱、再发布，不用标注原作者，不用开源你的改动。所以「变成自己的」不是许可问题，只是**改哪些地方、怎么改不出错**的问题。

先分清你属于哪种：

| 你的目标 | 走哪条 |
|---|---|
| 自己用，只想界面上是我的名字 | [第 1 节：五分钟改名字](#1-五分钟改名字) |
| 做成自己的产品，给别人注册用 | [第 1 节](#1-五分钟改名字) → [第 4 节](#4-变成能对外发布的自己的版本) |
| 想改功能、删模块、换 UI | [第 3 节](#3-改代码改到自己满意) |
| 只是想跟上游保持同步、吃更新 | [第 2 节的 A 方案](#a-保留上游关系fork) |

---

## 1. 五分钟改名字

### 一条命令

```bash
./scripts/rebrand.sh
```

Windows：

```bat
scripts\rebrand.cmd
```

它会逐项问你：产品名、副标题、主题色、包名。也可以一次说完，不交互：

```bash
./scripts/rebrand.sh \
  --name "鸭鸭短剧" \
  --tagline "AI 短剧工厂" \
  --color "#e05a3a" \
  --slug "yaya-drama"
```

| 参数 | 作用 | 不填会怎样 |
|---|---|---|
| `--name` | 产品名，出现侧栏、登录页、邮件标题、浏览器标签 | 问你 |
| `--tagline` | 名字下面那行小字，传 `""` 表示不显示 | 问你 |
| `--title` | 浏览器标签的完整文字，默认 `名字 · 副标题` | 自动拼 |
| `--color` | 主题色 `#rrggbb`。深色/浅色/护眼三套主题会自动配好明暗 | 保留琥珀金 |
| `--logo` | 换成你的图（建议 512×512，jpg，<4MB） | 用原来的 |
| `--slug` | 改成你的包名，如 `yaya-drama` | 不改 |
| `--reset-git` | 清空 git 历史，彻底断开与原仓库的关系 | 保留 |

脚本改的是这 6 个地方，全是品牌层，不碰业务逻辑：

```
.env                                  VW_SITE_NAME / VW_SITE_TAGLINE
apps/web/index.html                   <title>
apps/web/src/lib/site.ts              前端默认品牌（接口拿不到配置时的兜底）
apps/web/src/index.css                四套主题的 --color-accent / --color-accent-dim
README.md                             第一行标题
package.json                          name（只在给了 --slug 时）
```

### 改完必须重编

```bash
bun run build
```

**不重编不会生效**——`dist/` 里是编译好的静态文件，服务托管的是它，不是源码。

### 验证真的改了

```bash
bun apps/server/src/index.ts
```

开三个地方看：

1. 浏览器标签页标题
2. 左侧栏顶部（logo 右边的名字 + 下面小字）
3. 登录页（多人模式下 `/login`）

三处一致才算改干净。只改了一处，多半是 `.env` 没被读到，或者前端没重编。

### 为什么名字有两个来源

| 来源 | 优先级 | 什么时候用 |
|---|---|---|
| `.env` 的 `VW_SITE_NAME` | 高 | 运行时注入，同一个构建可以给不同站点用。改完只要重启，不用重编 |
| `apps/web/src/lib/site.ts` 的 `FALLBACK_NAME` | 低 | 接口还没返回时的兜底；编译进包里 |

所以有两种玩法：

- **只是换名字、还想跟上游同步** → 只写 `.env`，一行搞定：
  ```ini
  VW_SITE_NAME=鸭鸭短剧
  VW_SITE_TAGLINE=AI 短剧工厂
  ```
- **要做自己的发行版** → 跑 `rebrand.sh`，把默认值也改掉。这样别人 clone 你的仓库、什么都不配，看到的就是你的名字。

### 名字没生效？按这个顺序查

```
1. .env 在仓库根目录吗？       ls -la .env
2. 变量名拼对了吗？            VW_SITE_NAME，不是 SITE_NAME
3. 重启服务了吗？              .env 只在启动时读
4. 前端重编了吗？              bun run build（改了 site.ts / index.css / index.html 才需要）
5. 浏览器缓存？                强制刷新 Ctrl+Shift+R
6. 端口上跑的是旧进程吗？      lsof -i:4780 杀掉重开
```

服务启动时会打印当前站点名，先看日志对不对：

```
[vw] 站点: 鸭鸭短剧 · AI 短剧工厂
```

---

## 2. 变成自己的仓库

### A. 保留上游关系（Fork）

适合：想持续吃原作者的更新，不打算大改。

1. 仓库页面右上角 **Fork** → 选你的账号
2. `git clone https://github.com/你的用户名/geekreel.git`
3. 加一个上游地址，方便以后同步：

```bash
git remote add upstream https://github.com/chanjom/geekreel.git

# 以后同步更新
git fetch upstream
git merge upstream/main        # 冲突就按提示改
```

代价：别人一眼能看出你 fork 自谁；你的品牌改动集中在 `.env` 和少量文件，合并时可能冲突。

### B. 断开关系，当自己的项目（推荐做产品）

```bash
# 1. 拿一份，不要历史
git clone --depth 1 https://github.com/chanjom/geekreel.git my-product
cd my-product
rm -rf .git

# 2. 改成自己的名字
./scripts/rebrand.sh --name "鸭鸭短剧" --tagline "AI 短剧工厂" --slug "yaya-drama"

# 3. 重新 init 并推走
git init -b main
git add -A
git commit -m "初始化：鸭鸭短剧"
git remote add origin https://github.com/你的用户名/yaya-drama.git
git push -u origin main
```

或者让脚本顺手做掉第 1、3 步的历史部分：

```bash
./scripts/rebrand.sh --reset-git
```

它会二次确认（要你手打 `RESET`），因为原历史删了就没了。

> 网页操作也行：仓库页 **Code → Download ZIP** → 解压 → 在 GitHub 新建空仓库 → 上传文件。注意 ZIP 里没有 `.git`，等于已经断开了。

### C. 推之前检查有没有带出不该带的东西

```bash
git status --short
du -sh .git
```

`.gitignore` 已经排除 `node_modules/`、`dist/`、`.env`、`*.db`、`*.secret`。

**最关键的一条：`.env` 和数据库绝不能提交。** 里面有加密模型密钥的主密钥，拿到就能解出你所有 API key。

已经误传了：

```bash
git rm --cached .env
echo ".env" >> .gitignore
git commit -m "移除误提交的配置"
```

然后**立刻去厂商后台吊销那批 key 重发**。删 commit 没用，公开仓库的历史里还在，爬虫几分钟就扫到。

---

## 3. 改代码改到自己满意

### 先认清结构

```
apps/web/                前端（React 19 + Vite + Tailwind v4）
  src/pages/             每个菜单一个文件，改界面基本只动这里
  src/components/        共用组件
    layout.tsx           左侧栏、导航项
    authShell.tsx        登录页外壳（左侧营销区 + 右侧表单）
    brand.tsx            品牌标识
  src/lib/
    site.ts              品牌名/副标题
    i18n.ts              中英文案
    prefs.ts             主题、字号、语言
  src/index.css          主题色变量（四套）
  public/logo.jpg        logo

apps/server/             后端（Bun + Hono + SQLite）
  src/routes/            每个 /api 前缀一个文件
  src/services/          业务逻辑（生成、渲染、雷达、分析）
  src/jobs/queue.ts      任务队列
  src/db.ts              建表 + 迁移
  src/config.ts          所有环境变量入口

packages/                共享包
  models/                各家模型适配器（接新厂商改这里）
  pipeline/              剧本 → 定妆 → 分镜 → 出片
  media/                 ffmpeg 封装
  radar/ analyze/ remake/ style/ push/
```

更细的数据流、接口表、接模型踩过的坑：见 [WORKFLOW.md](WORKFLOW.md)。

### 常见改动

**换 logo**

覆盖 `apps/web/public/logo.jpg`，方形、512×512 最好。或者 `--logo 路径` 让脚本拷过去。改完 `bun run build`。

**换主题色**

`apps/web/src/index.css` 里有四组 `--color-accent`（`@theme`、dark、light、eye）。手改要四组一起改，只改一组会出现「深色对了、浅色瞎了」。跑 `rebrand.sh --color` 会按明度自动算好四组。

**改登录页左侧那句大标题**

`apps/web/src/components/authShell.tsx` 的 `MarketingPanel`：大标题、卖点、流程条都在这里。

**改首页引导语**

`apps/web/src/pages/homePage.tsx`。

**加一个菜单**

1. `apps/web/src/pages/` 新建页面
2. `apps/web/src/app.tsx` 加 `<Route>`
3. `apps/web/src/components/layout.tsx` 的 `navItems` 加一行
4. `apps/web/src/lib/i18n.ts` 的 `zh.nav` 和 `en.nav` **各加一个 key**（少了英文那个会类型报错）

**接一个新模型厂商**

1. 照 `packages/models/src/` 里现有的适配器写一个（OpenAI 兼容的最简单，抄 deepseek）
2. 在 `packages/models/src/register.ts` 注册
3. 前端「模型」页的预置列表自动出现

**删掉不要的模块**

| 想删 | 怎么删 |
|---|---|
| 热点雷达 | `apps/server/src/app.ts` 去掉 `radarRoutes`；`layout.tsx` 去掉菜单项；删 `pages/radarPage.tsx` |
| 竞品分析 | 同上，`analyzeRoutes` + 菜单 + 页面 |
| 连载 | `seriesRoutes`、`/series` 路由、菜单、`pages/seriesPage.tsx` |
| 画布 | `canvasRoutes`、`/canvas`、菜单 |
| 注册功能 | `.env` 里 `VW_ALLOW_REGISTER=0`，只留管理员开号 |
| 整个账号体系 | `VW_MULTI_USER=0`，回到单机模式（打开即用，本机就是管理员） |

删接口记得把前端页面一起删，否则控制台会一直刷 404。

### 改完必须跑的三条

```bash
bun run typecheck     # 类型
bun test              # 单测（191 个）
bun run build         # 前端能不能编出来
```

三条全绿再提交。只跑 `build` 不跑 `typecheck`，很容易把类型错误带到线上。

---

## 4. 变成能对外发布的自己的版本

### 4-1. 打自己的镜像

```bash
docker build -t 你的dockerhub名/yaya-drama:0.1.0 .
docker push 你的dockerhub名/yaya-drama:0.1.0
```

别人就不用 clone 代码：

```yaml
services:
  app:
    image: 你的dockerhub名/yaya-drama:0.1.0
    ports: ["127.0.0.1:4780:4780"]
    environment:
      VW_MULTI_USER: "1"
      VW_ALLOW_REGISTER: "1"
      VW_SITE_NAME: "鸭鸭短剧"
      VW_SITE_TAGLINE: "AI 短剧工厂"
      VW_PUBLIC_URL: "https://你的域名"
    volumes:
      - ./data:/data
      - ./library:/library
```

### 4-2. 让部署里也带你的名字

镜像里已经编进了 `rebrand.sh` 改过的默认值。但如果你**没跑** rebrand、只想临时换名，就在 `environment` 里给 `VW_SITE_NAME`——环境变量优先级高于代码默认值，重启即生效，不用重打镜像。

### 4-3. 发版前自查

```
[ ] .env 没提交；仓库里全局搜不到 sk- / api_key / secret     grep -rn "sk-" . --exclude-dir=node_modules
[ ] docker build 从零成功（不靠本地 node_modules 残留）
[ ] 空数据目录启动一次：能注册、能登录、能建项目、能出片
[ ] 换台机器 docker run 一次：数据卷挂上去，历史项目还在
[ ] README 截图和实际界面对得上（改了品牌就重截）
[ ] 站点名、副标题、logo、favicon 四处一致
[ ] LICENSE 是你想要的那个
```

### 4-4. 更新版本号

三处 + 一处常量，漏一个界面上就会显示旧版本：

```
package.json
apps/server/package.json
apps/web/package.json
apps/server/src/config.ts   → export const version
```

---

## 5. 许可证

本仓库是 **Unlicense**：不用署名、可以闭源、可以商用、可以再卖。你换成 MIT、Apache-2.0、或者商业授权都行，直接改 `LICENSE` 文件。

但**依赖**不是你的：

| 依赖 | 许可 | 商用注意 |
|---|---|---|
| ffmpeg | LGPL / GPL（取决于编译选项） | 静态链接 GPL 版有传染性；用系统包/项目依赖一般没事 |
| yt-dlp | Unlicense | 随便用 |
| React / Vite / Tailwind / Hono | MIT | 保留版权声明 |
| 内置字体、示例截图 | 见各自文件 | 商用前确认字体授权 |

另外：**风格包**里的提示词是文本，可以商用；但「上美影」是上海美术电影制片厂的品牌，别拿它当你的产品名或宣传语。

---

## 6. 改完之后怎么让别人也能用

流程和原版完全一样，只是仓库地址换成你的：

| 要做的事 | 看哪份 |
|---|---|
| 服务器部署、域名、HTTPS、发信、备份 | [SELF-HOST.md](SELF-HOST.md) |
| 教新人从零出第一条片子 | [TUTORIAL.md](TUTORIAL.md)，可以整份复制到你的文档站 |
| 一键安装 | `scripts/setup.sh` / `setup.cmd`，跟随代码走，不用改 |

只有一处要留意：`setup.cmd` 和 `setup.sh` 里打印的提示文字带着 `[geekreel]` 前缀。想彻底换成你的，全局替换一下：

```bash
grep -rln "geekreel" scripts/ docs/ README.md
```

---

## 7. 一句话版本

```bash
git clone --depth 1 https://github.com/chanjom/geekreel.git my-product && cd my-product
rm -rf .git
./scripts/rebrand.sh --name "你的产品名" --tagline "你的副标题" --color "#你的主题色"
bun run build
git init -b main && git add -A && git commit -m "初始化"
```

跑起来看一眼：名字、副标题、颜色、标题栏全变了，业务功能一个没动。剩下的（文案、菜单、功能取舍）按第 3 节慢慢改。
