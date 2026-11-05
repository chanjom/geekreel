# 交付说明 · GeekReel AI Studio 0.2.0

这个包是完整的、可运行的源码。解压就能跑，不需要再找我拿别的东西。

- 版本：`0.2.0`
- 提交：`4d4b35b`（仓库 <https://github.com/chanjom/geekreel>）
- 许可证：Unlicense（可改名、可闭源、可商用、可再发布）

---

## 一、包里有什么

```
geekreel-0.2.0/
├── 交付说明.md            ← 你正在看的这份
├── README.md              项目介绍、功能清单、界面截图
├── .env.example           所有配置项，每项都有注释
├── scripts/
│   ├── setup.sh           ← macOS / Linux 一键装并启动
│   ├── setup.cmd          ← Windows 一键装并启动
│   ├── dev.sh / dev.cmd   开发态（改代码热更新）
│   └── start.sh / .cmd    只启动，不重装
├── docs/
│   ├── START-HERE.md      三种人三条路（推荐第一份读这个）
│   ├── TUTORIAL.md        零基础教程：装环境 → 出第一条片子
│   ├── SELF-HOST.md       服务器部署：域名、HTTPS、发信、备份、合规
│   ├── FORK.md            改成自己的品牌 / 自己的仓库
│   ├── WORKFLOW.md        内部链路、模块地图、模型适配的坑
│   └── design.md          架构设计
├── apps/web/dist/         已经编译好的网页（所以不用先 build 也能跑）
├── apps/server/           后端（Bun + Hono + SQLite）
├── packages/              适配器、流水线、媒体、雷达、分析等
└── Dockerfile / docker-compose.yml / deploy/nginx.conf
```

**没有**包含：`node_modules`（跑脚本会自动装）、`.git` 历史、yt-dlp 二进制（首次用到竞品分析会自动下载）、任何密钥或我的本地数据。

---

## 二、三种用法

### A. 在自己电脑上用（5 分钟）

1. 装 Bun（只需一次）
   - Windows：PowerShell 里跑 `powershell -c "irm bun.sh/install.ps1 | iex"`
   - macOS / Linux：`curl -fsSL https://bun.sh/install | bash`
   - **装完关掉终端重开**
2. 解压本包，进到 `geekreel-0.2.0` 目录
3. Windows 跑 `scripts\setup.cmd`；macOS / Linux 跑 `chmod +x scripts/setup.sh && ./scripts/setup.sh`
4. 浏览器打开 <http://127.0.0.1:4780>
5. 到「模型」页填一个模型 key，回首页开始

不需要注册。详细版：[docs/TUTORIAL.md](docs/TUTORIAL.md)

### B. 放到服务器上给别人用（约 40 分钟）

```bash
git clone https://github.com/chanjom/geekreel.git   # 或者上传这个包
cd geekreel
cp .env.example .env
# 编辑 .env：VW_MULTI_USER=1、VW_ALLOW_REGISTER=1、VW_REGISTER_CODE=你的邀请码、VW_HOST=0.0.0.0
docker compose up -d --build
```

然后配域名和 HTTPS。完整步骤 + 上线检查清单：[docs/SELF-HOST.md](docs/SELF-HOST.md)

第一个注册的账号自动成为管理员，之后在左侧「账号管理」里给其他人开号、停用、发重置链接。

### C. 改成自己的产品

1. 解压后 `rm -rf .git`（包里本来就没有）
2. 改 `.env` 的 `VW_SITE_NAME`、替换 `apps/web/public/logo.jpg`
3. `git init` + 推到自己的仓库，或者 `docker build` 打自己的镜像

想改代码从哪下手：[docs/FORK.md](docs/FORK.md)

---

## 三、这个版本新增了什么

对照 0.1.2：

| 模块 | 内容 |
|---|---|
| 忘记密码 | 一次性令牌（1 小时、只能用一次、存哈希）；配了 SMTP 自动发信，没配就落盘 + 日志打印，管理员也能在后台直接生成链接 |
| 邮箱验证 | 可选开启。**只在配好 SMTP 时生效**，否则注册完会卡死 |
| 管理员后台 | `/admin`：账号列表、直接开号、停用/启用、改角色、发重置链接、30 天用量 |
| 登录页 | 左右分栏重做；显示密码、密码强度、记住邮箱、条款勾选、邀请码、首管理员引导 |
| 配套页面 | `/forgot`、`/reset`、`/verify`、`/terms`、`/privacy` |
| 安全 | 改密后踢掉该用户所有旧登录；不能停用/降级自己；不能删掉最后一个管理员；接口错误带业务码 |
| 交付 | 一键安装脚本、`.env` 自动读取、启动自检日志、四份文档 |

---

## 四、我真的测过什么

在 Windows 11 + Bun 1.4.4 上实跑过：

```
[√] 首个注册自动成为管理员，并接管历史数据
[√] 未登录访问业务接口 → 401
[√] 普通用户访问 /api/admin → 403
[√] 管理员开号 → 新号能登录
[√] 重复邮箱注册 → 409 + code=exists
[√] 未勾选条款注册 → 400 + code=terms
[√] 弱密码（12345678）→ 拒绝
[√] 管理员生成重置链接 → 校验通过 → 改密成功 → 令牌不可复用
[√] 改密后旧 cookie 立刻失效（401）
[√] 停用账号 → 登录被拒 + code=disabled
[√] 停用/降级自己 → 拒绝
[√] 没配 SMTP 时「忘记密码」→ 写进 data/outbox/*.eml，接口不回传链接
[√] 登录页 / 注册页 / 条款页 / 静态资源 → 200
[√] 移动端 500px 宽布局正常，无横向溢出
[√] 单机模式回归：不登录照常用，原有数据不受影响
[√] bun run typecheck 全部包通过
[√] bun test → 191 passed / 0 failed
```

## 五、我没能验证的（重要）

| 项 | 为什么 | 你该怎么做 |
|---|---|---|
| **Docker 镜像构建** | 这台机器没装 Docker | 第一次 `docker compose up -d --build` 时留意日志；失败把报错发我 |
| **真实 SMTP 发信** | 没有可用的邮箱授权码 | 配好后用「忘记密码」给自己发一封测一下 |
| **公网域名 + HTTPS** | 没有服务器和域名 | 按 SELF-HOST 第 3 节走；卡住的地方发我 |
| **macOS / Linux 实跑** | 只有 Windows 环境 | 脚本按 POSIX 写，`chmod +x` 后应该能跑；异常发我 |
| **手机号/实名、第三方登录** | 本版本没做 | 公开运营前必须补，见 SELF-HOST 合规一节 |

---

## 六、上线前必须想清楚的三件事

1. **模型 key 谁出钱。** 本工具不代付、没有充值余额。默认每人填自己的 key（你零成本）；你统一发就你承担账单。
2. **合规。** 大陆服务器 + 域名要备案；面向公众提供生成式 AI 服务另有备案义务；当前只有邮箱密码，**不满足实名要求**。细节见 SELF-HOST 第 11 节。
3. **备份 `/data` 和 `library/`。** `/data/.secret` 丢了以后所有用户存的 key 都解不开。文档里有备份和恢复命令。

---

## 七、找我改什么

按优先级排，这些都是我知道还欠着的地方：

- Docker 实际跑通一遍，把构建时间和小问题修掉
- 手机号登录 / 微信登录（公开运营的硬门槛）
- 生成内容的审核与留痕（合规）
- 细粒度额度：管理员给每个账号设每月上限
- WebSocket 按用户隔离（现在是全局广播，只有进度没有内容）
- 计费/充值（如果你要代付模式）

需要哪个直接说，或者自己在 `docs/FORK.md` 里找入口改 —— 代码结构是按"能被别人接手"写的。
