# 多人部署：让别人的账号也能用

这份文档对应"给别人用"这个目标。默认你已经有一台能公网访问的服务器。

---

## 一、你需要准备的东西

| # | 项目 | 规格 / 说明 | 不准备的后果 |
|---|---|---|---|
| 1 | 云服务器 | 2 核 4G 起，**磁盘 100G 起**（视频很吃空间），Ubuntu 22.04 / Debian 12 | 转码时 OOM，成片写不进去 |
| 2 | 域名 | 可选但强烈建议。没有域名只能用 `IP:4780`，浏览器会限制剪贴板、且无法上 HTTPS | 密码明文在公网传输 |
| 3 | 备案 | **中国大陆服务器 + 域名对外提供服务，必须 ICP 备案**，否则云厂商封 80/443 | 被停机 |
| 4 | 账号策略 | 是否开放注册、要不要邀请码、每人是否自带 key | 陌生人批量注册占坑 |

**关于"用户自带 key"**：本站不代付模型费用，每个账号到「模型」页填自己的火山／通义／豆包密钥。
好处是你零成本；代价是新用户注册后是空壳，必须自己配 key 才能生成。
建议在首页放一句话说明，或你自己准备一份"申请 key 的图文步骤"发给对方。

---

## 二、三步部署

### 1. 上传代码并起容器

```bash
git clone https://github.com/chanjom/geekreel.git
cd geekreel

# 生成一份环境变量（可选：设邀请码）
cat > .env <<'EOF'
VW_ALLOW_REGISTER=1
VW_REGISTER_CODE=换成你自己的邀请码
VW_SECURE_COOKIE=0
EOF

docker compose up -d --build
docker compose logs -f geekreel    # 看到 [vw] server 已启动 即成功
```

此时服务只在 `127.0.0.1:4780`，外网还进不来。

### 2. 配反向代理

```bash
sudo cp deploy/nginx.conf /etc/nginx/conf.d/geekreel.conf
sudo sed -i 's/example.com/你的域名/g' /etc/nginx/conf.d/geekreel.conf
sudo certbot --nginx -d 你的域名          # 自动申请证书并改写配置
sudo nginx -t && sudo systemctl reload nginx
```

证书就位后，把 `.env` 里的 `VW_SECURE_COOKIE` 改成 `1`，重新 `docker compose up -d`。

### 3. 注册第一个账号

打开 `https://你的域名`，会看到登录页。

**第一个注册的人自动成为管理员**，并接管服务器上已有的所有项目（全新部署就是空的）。
以后注册的都是普通用户。

管理员额外拥有：热点雷达、推送通道、全局素材库路径设置、服务器目录浏览。

---

## 三、环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `VW_MULTI_USER` | `0` | **必须设 1**。开多人模式，强制登录 + 数据隔离 |
| `VW_ALLOW_REGISTER` | `0` | 是否开放自助注册。关掉后只能管理员在库里手工建号 |
| `VW_REGISTER_CODE` | 空 | 设了就要求注册时填邀请码，公网部署建议设 |
| `VW_SESSION_DAYS` | `30` | 登录保持天数 |
| `VW_SECURE_COOKIE` | `0` | 挂 HTTPS 后设 1，cookie 只走加密连接 |
| `VW_DATA_DIR` | `~/.video-workbench` | 数据库与会话密钥位置。容器里是 `/data` |
| `VW_HOST` / `VW_PORT` | `127.0.0.1` / `4780` | 监听地址。容器内固定 `0.0.0.0:4780` |

---

## 四、隔离边界（做到什么程度）

不同的用户之间：

| 资源 | 隔离方式 |
|---|---|
| 项目 | `projects.ownerId`，列表/详情/改/删全部按 owner 过滤，越权返回 404 |
| 素材 | 挂项目的随项目；素材库的按 `assets.ownerId` |
| 任务 | `jobs.ownerId`，只能看/取消/重试自己的 |
| 模型端点 | `model_endpoints.ownerId`，看不到别人的 key，也不能拿别人的端点发起调用 |
| 连载 / 分析报告 | 各自 `ownerId` |
| 用量统计 | `model_usage.userId` |

**关闭的功能**（远程部署下没有意义且有风险）：

- 服务器目录浏览 `/api/fs/browse`：403
- 按服务器路径导入素材：403
- 热点雷达 / 推送通道：仅管理员

**尚未隔离的**（已知限制，写在这里避免误判）：

- WebSocket 事件是全局广播。任务进度里带 `projectId`，理论上能看到"别人有个任务跑完了"，但拿不到内容。
- 风格包、设置里的版本/ffmpeg 信息是全局只读。
- 管理员能看到全部数据（这是设计如此）。

---

## 五、备份（别跳过）

```bash
# 数据库 + 会话密钥，必须一起备，分开备等于废的
docker compose exec geekreel tar czf - -C /data . > backup-$(date +%F).tar.gz

# 项目与素材（体积大，建议 rsync 到对象存储）
rsync -av ./library/ /备份路径/library/
```

`/data/.secret` 是密钥加密主密钥，**丢了以后所有已保存的 API key 都解不开**，用户得重填。

---

## 六、合规（认真看这一段）

对外提供 AI 生成服务，在中国大陆不只是技术问题：

1. **ICP 备案**：域名 + 大陆服务器，必须备案后才能开 80/443。
2. **生成式 AI 服务备案**：按《生成式人工智能服务管理暂行办法》，面向公众提供生成式 AI 服务需要履行备案/安全评估义务。你用的是第三方模型 API，但对外提供的是"生成服务"，责任在你这一侧。
3. **内容安全**：用户输入故事 → 生成画面和台词。必须有内容审核或至少人工巡查，否则出现违规内容由运营者担责。
4. **实名**：面向公众的账号体系，通常需要手机号或实名认证。当前实现只有邮箱+密码，**不满足实名要求**，这是上线前必须补的。
5. **未成年人保护**：短剧题材容易被用来生成不当内容，建议加敏感词过滤和生成记录留存（当前已存 `model_usage`，但没存 prompt 内容）。

如果只是给几个认识的人用（内部工具），上面 2–5 条压力小很多；一旦公开注册，这些都是硬门槛。

---

## 七、日常运维

```bash
docker compose logs -f --tail=200 geekreel   # 看日志
docker compose restart geekreel              # 重启（不影响已存数据）
docker compose up -d --build                 # 升级代码
```

**限流位置**：登录 15 分钟 12 次 / IP，注册 1 小时 5 次 / IP（`apps/server/src/routes/auth.ts` 顶部）。这是进程内内存计数，**多实例部署要换成 Redis**，否则每个实例各算各的。

**任务并发**：`apps/server/src/index.ts` 里 `jobQueue.register(type, handler, 并发数)`。多人同时跑视频时，把 `gen.video` 的并发从 2 降下来，否则会打满 CPU 和第三方限流。

---

## 八、给新用户的一句话说明

注册完进到首页，先去「模型」页加一个文本模型端点，填自己的 key，点「测试连通」。
不配端点的话，任何生成按钮都会提示"未配置模型"。
