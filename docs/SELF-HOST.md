# 部署给别人用：从一台空服务器到能发网址

目标：别人打开 `https://reel.你的域名.com`，自己注册、自己填 key、自己做片子，看不到别人的东西。

全程约 40 分钟，不需要懂后端。**照着复制粘贴就行**，每个代码块都标了「在哪台机器上执行」。

---

## 0. 先定三件事

不先想清楚这三件，部署完会返工：

### ① 模型 key 谁出？

| 方案 | 你的成本 | 用户体验 | 怎么配 |
|---|---|---|---|
| **各人自带**（推荐） | 0 元 | 注册后要自己申请一次 key | 默认就是这个，不用配 |
| 你统一发 | 你付全部 | 注册完立刻能用 | 你申请一个 key，发给每个人自己填 |
| 平台代付 | 你付 + 对账麻烦 | 最好 | **本版本不支持**，需要改代码接计费 |

这个工具**没有**代付、充值、余额的概念。界面上写得很直白：本站不代付。

### ② 开放注册还是发号？

| 策略 | 配置 | 适合 |
|---|---|---|
| 开放注册 + 邀请码 | `VW_ALLOW_REGISTER=1` + `VW_REGISTER_CODE=xxx` | 半公开，发给朋友 |
| 只管理员开号 | `VW_ALLOW_REGISTER=0` | 团队内部，最可控 |
| 完全开放 | `VW_ALLOW_REGISTER=1`，不设邀请码 | 不建议，会被扫到并批量注册 |

### ③ 有没有域名？

- **有域名**：能上 HTTPS，密码不会明文传，微信里也能打开。
- **只有 IP**：只能 `http://1.2.3.4:4780`。浏览器会限制部分功能，密码明文过网，**不建议给不熟的人用**。

---

## 1. 准备服务器

### 配置

| 项 | 最低 | 推荐 | 说明 |
|---|---|---|---|
| CPU | 2 核 | 4 核 | ffmpeg 合成很吃 CPU，人多了要排队 |
| 内存 | 4G | 8G | 2G 会在转码时 OOM |
| 磁盘 | 100G | 200G+ | 一集 3 分钟竖屏片子约 200–500MB，加素材翻倍 |
| 带宽 | 3M | 5M+ | 主要影响下载成片的速度 |
| 系统 | Ubuntu 22.04 / Debian 12 | 同 | 别用 CentOS 7，软件太旧 |

国内厂商（阿里云/腾讯云）买个「轻量应用服务器」2 核 4G 就够起步，约 60–100 元/月。

> **重要**：服务器是给**生成**用的，视频本身是调云端模型生成的，本地只做拼接和压缩。所以不需要显卡。

### 登录服务器

```bash
# 在你自己的电脑上执行。IP 换成你的
ssh root@1.2.3.4
```

### 安全组 / 防火墙

云厂商控制台里，放行这几个端口：

- `22`（SSH，最好限制成你自己的 IP）
- `80`、`443`（网站）
- **不要**放行 `4780`。它只在机器内部用，外面一律走 nginx。

---

## 2. 装上去跑起来

有两条路，选一条。**推荐 Docker**，升级和搬家最省事。

### 路线 A：Docker（推荐）

```bash
# 服务器上执行
curl -fsSL https://get.docker.com | sh
git clone https://github.com/chanjom/geekreel.git
cd geekreel

cp .env.example .env
nano .env      # 或者用 vim，改下面这几项
```

`.env` 里至少要改这四行：

```ini
VW_MULTI_USER=1
VW_ALLOW_REGISTER=1
VW_REGISTER_CODE=换成你自己的邀请码
VW_HOST=0.0.0.0
```

启动：

```bash
docker compose up -d --build
docker compose logs -f geekreel
```

看到 `[vw] 视频工作台 server 已启动` 就好了。`Ctrl+C` 退出日志不影响运行。

验证一下容器内部是通的：

```bash
curl -s http://127.0.0.1:4780/api/health
# {"ok":true,"data":{"version":"0.2.0","now":...}}
```

### 路线 B：不装 Docker，直接用 Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc          # 让 bun 命令生效

git clone https://github.com/chanjom/geekreel.git
cd geekreel
cp .env.example .env
nano .env                 # 同上，改那四项

bun install
./scripts/setup.sh multi  # 会自动生成 .env 并启动
```

想让它开机自启、断开 SSH 也不停，用 systemd：

```bash
sudo tee /etc/systemd/system/geekreel.service >/dev/null <<'EOF'
[Unit]
Description=GeekReel
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/geekreel
ExecStart=/root/.bun/bin/bun apps/server/src/index.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now geekreel
sudo systemctl status geekreel     # 看是不是 active (running)
journalctl -u geekreel -f          # 看日志
```

---

## 3. 配域名和 HTTPS

### 3.1 域名解析

到你买域名的地方（阿里云/腾讯云/Cloudflare），加一条 A 记录：

```
主机记录  reel        （想要 reel.你的域名.com）
记录类型  A
记录值    你的服务器公网 IP
```

等 1–10 分钟生效。验证：

```bash
ping reel.你的域名.com     # 能解析到你的 IP 就行
```

### 3.2 装 nginx 和证书

```bash
# 服务器上执行
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx

sudo cp deploy/nginx.conf /etc/nginx/conf.d/geekreel.conf
sudo sed -i 's/example.com/你的域名/g' /etc/nginx/conf.d/geekreel.conf

# 先拿到证书（会问你邮箱、同意条款）
sudo certbot --nginx -d 你的域名

sudo nginx -t && sudo systemctl reload nginx
```

现在打开 `https://你的域名` 应该能看到登录页了。

> **国内服务器**：域名必须完成 ICP 备案，否则 80/443 会被云厂商拦截，表现为「域名打不开但 IP 能开」。
> 没备案前可以先只给 IP 用，或把服务放到香港/海外服务器（无需备案，但国内访问慢）。

### 3.3 打开「安全 cookie」

HTTPS 通了之后，`.env` 里改一行，否则 cookie 在部分浏览器下会被拒：

```ini
VW_SECURE_COOKIE=1
```

然后重启：

```bash
docker compose up -d          # Docker
sudo systemctl restart geekreel   # 裸机
```

---

## 4. 注册第一个账号（你，管理员）

打开你的网址，会看到登录页。

**点「立即注册」，第一个注册的账号自动成为管理员。**

- 管理员比普通用户多一个菜单：**账号管理**
- 里面能看到所有账号、停用/启用、设为管理员、生成密码重置链接、看全站用量

注册完进去后：

1. 先去 **模型** 页配好文本 + 视频端点（你自己用的那份 key）
2. 到 **账号管理** 里看看策略对不对
3. 把网址和邀请码发给别人

### 别人怎么开始

把这三句话发给对方：

> 1. 打开 https://你的域名，用邮箱注册，邀请码是 `xxx`
> 2. 登录后左边点「模型」，选一个厂商填你自己的 API key（怎么申请：见文档第 3 节）
> 3. 回首页，输入框里写你想拍什么，跟着走

更完整的、可以直接转发给新人的版本：[TUTORIAL.md](TUTORIAL.md)

---

## 5. 配置说明（.env 全表）

改完 `.env` 必须重启才生效（`docker compose up -d` 或 `systemctl restart geekreel`）。

| 变量 | 默认 | 说明 |
|---|---|---|
| `VW_SITE_NAME` | `GeekReel` | 站点名，出现在登录页、邮件、浏览器标题 |
| `VW_HOST` | `127.0.0.1` | 对外服务必须 `0.0.0.0`；Docker 里已固定 |
| `VW_PORT` | `4780` | 端口 |
| `VW_DATA_DIR` | `~/.video-workbench` | 数据库、密钥、发件箱。**必须备份** |
| `VW_LIBRARY_ROOT` | `~/VideoWorkbench` | 素材与成片根目录。**必须备份** |
| `VW_PUBLIC_URL` | 空 | 对外地址，用于拼邮件里的链接。填 `https://你的域名` |
| `VW_MULTI_USER` | `0` | 对外必须 `1`，否则不登录就能用你的 key |
| `VW_ALLOW_REGISTER` | `0` | 是否开放注册。第一个账号永远是管理员 |
| `VW_REGISTER_CODE` | 空 | 邀请码。设了就必须填对 |
| `VW_SESSION_DAYS` | `30` | 登录保持天数 |
| `VW_SECURE_COOKIE` | `0` | HTTPS 之后设 `1` |
| `VW_REQUIRE_EMAIL_VERIFY` | `0` | 注册必须验证邮箱。**要先配 SMTP**，否则没人能登录 |
| `VW_SMTP_*` | 空 | 见下一节 |

完整的注释版在仓库根 `.env.example`。

---

## 6. 发信配置（找回密码）

**不配也能用**：用户忘记密码时，让他在登录页点「忘记密码」，然后你在 **账号管理** 里点「重置链接」，把生成的地址复制发给他。链接 1 小时有效、只能用一次。

配了 SMTP 之后，用户就能自己走完找回流程。

以 QQ 邮箱为例：

1. QQ 邮箱 → 设置 → 账户 → 开启「POP3/SMTP 服务」→ 生成**授权码**（不是 QQ 密码）
2. `.env` 里填：

```ini
VW_SMTP_HOST=smtp.qq.com
VW_SMTP_PORT=465
VW_SMTP_USER=你的QQ@qq.com
VW_SMTP_FROM=你的QQ@qq.com
VW_SMTP_PASS=刚生成的授权码
VW_SMTP_TLS=1
```

3. 重启，然后到登录页点「忘记密码」用自己的邮箱试一次，收到就通了。

**只支持 465（SSL）和明文端口**（25 / 本机 relay）。587 的 STARTTLS 不支持 —— 这是刻意的，为了少一棵依赖树；国内邮箱基本都用 465。

发不出去时：邮件不会丢，会写进 `data/outbox/*.eml`，日志里也会打印完整重置链接（`docker compose logs geekreel | grep 重置密码`）。

---

## 7. 上线检查清单

复制这段，逐条打勾：

```
[ ] 域名能打开，是 https，地址栏有小锁
[ ] VW_MULTI_USER=1，退出登录后直接访问首页会跳回 /login
[ ] VW_SECURE_COOKIE=1
[ ] VW_REGISTER_CODE 已设，注册页要求填邀请码
[ ] 用另一个邮箱注册一个测试号：看不到管理员的项目、看不到「账号管理」菜单
[ ] 测试号点「忘记密码」：能收到邮件（或管理员能生成链接）
[ ] 测试号随便生成一张图：证明 key 配置正确
[ ] 建一个测试项目、传一个视频、导出一段，确认磁盘能写、ffmpeg 正常
[ ] 备份脚本跑过一次，并真的能从备份里恢复
[ ] 服务器安全组没有对外开放 4780
```

---

## 8. 备份与恢复

```bash
# 数据库 + 加密密钥（必须一起备！）
docker compose exec geekreel tar czf - -C /data . > backup-$(date +%F).tar.gz

# 素材与成片（体积大）
rsync -av ./library/ /备份盘/library/
```

`/data/.secret` 是加密主密钥。**丢了以后所有用户保存的 API key 都解不开**，每个人都得重填 —— 数据没丢，但体验很糟。

恢复：

```bash
docker compose down
tar xzf backup-2026-11-05.tar.gz -C ./data
rsync -av /备份盘/library/ ./library/
docker compose up -d
```

建议加个每日定时任务，示例：

```bash
# crontab -e
0 4 * * * cd /root/geekreel && docker compose exec -T geekreel tar czf - -C /data . > /root/backup-$(date +\%F).tar.gz
```

---

## 9. 升级

```bash
cd geekreel
git pull
docker compose up -d --build     # 数据库会自动迁移，不丢数据
```

裸机：`git pull && bun install && sudo systemctl restart geekreel`。

升级前先备份 `/data`。数据库迁移是自动的（启动时 `ensureColumn` 加字段），但大版本之间不保证向下兼容。

---

## 10. 故障排查

| 现象 | 先看这里 |
|---|---|
| 502 Bad Gateway | 容器没起：`docker compose ps`、`docker compose logs --tail=50 geekreel` |
| 域名打不开，IP 能开 | DNS 没生效，或大陆服务器没备案被拦 |
| 登录后立刻跳回登录页 | `VW_SECURE_COOKIE=1` 但访问的是 http；或反代没传 `X-Forwarded-Proto` |
| 上传大视频报 413 | nginx `client_max_body_size` 太小，`deploy/nginx.conf` 里已设 512m，按需再调 |
| 任务卡在 running | 看日志有没有模型报错；重启容器会把未完成任务标记失败，重试即可 |
| 磁盘满 | `docker system df`、`du -sh library/`；清资产库里的旧项目 |
| 忘记管理员密码 | 在服务器上停服务，把 `data/vw.db` 里 `users` 表该账号 `role` 改回来；或直接改 `passwordHash` 为空后走重置 —— **最省事的办法：保留第二个管理员账号** |
| 页面白屏 | 网页没编译：`docker compose up -d --build` 会重新编译；裸机跑 `bun run build` |

---

## 11. 合规（认真读）

对外提供 AI 生成服务，在中国大陆不只是技术问题：

1. **ICP 备案**：域名 + 大陆服务器必须备案。
2. **生成式 AI 服务备案**：面向公众提供生成式 AI 服务，需要按《生成式人工智能服务管理暂行办法》履行备案/安全评估义务。模型是第三方的，但对外提供「生成服务」的是你。
3. **内容安全**：用户输入故事 → 生成画面和台词。必须有审核或人工巡查，违规内容由运营者担责。
4. **实名**：当前只有邮箱 + 密码，**不满足**面向公众服务的实名要求。公开注册前需要补手机号或实名认证。
5. **未成年人保护**：建议加敏感词过滤和生成记录留存。

只给几个认识的人用（内部工具），2–5 条压力小很多；一旦公开注册，这些是硬门槛。

---

## 12. 已知限制

写在明处，免得上线后才发现：

- **WebSocket 是全局广播**：别人能看到「有个任务完成了」这类事件，但看不到内容（事件里只有 jobId / projectId / 进度）。
- **限流是单进程内存计数**：多实例部署要换成 Redis，否则每个实例各算各的。
- **删除用户前必须先清空他的项目**：防止误删素材。账号管理里会拦。
- **不支持手机号登录、第三方登录**（Google/微信）：需要自己接。
- **没有计费、充值、余额**：费用在用户自己的模型厂商账户里。
- **单机模式下的 `/api/fs` 能读服务器任意目录**：多人模式下已自动禁用。

---

## 相关文档

- [START-HERE.md](START-HERE.md) —— 三种人三条路
- [TUTORIAL.md](TUTORIAL.md) —— 零基础使用教程（可直接转发给用户）
- [FORK.md](FORK.md) —— 改成自己的品牌 / 自己的仓库
- [DEPLOY-MULTIUSER.md](DEPLOY-MULTIUSER.md) —— 早期版本，数据隔离边界的细节仍可参考
