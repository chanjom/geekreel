#!/usr/bin/env bash
# 一条命令装好并启动。
#
#   ./scripts/setup.sh          自己用（不需要登录，打开就能用）
#   ./scripts/setup.sh multi    给别人用（要登录、开放注册、局域网可访问）
#
# 第一次会装依赖 + 编网页，大概 1–3 分钟。之后再用就只要几秒。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="${1:-single}"
export PATH="${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

say() { printf "\n\033[1;33m[geekreel]\033[0m %s\n" "$1"; }
die() { printf "\n\033[1;31m[geekreel]\033[0m %s\n" "$1"; exit 1; }

# --- 1. Bun -----------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  cat <<'EOF'

  这台机器还没有装 Bun（运行环境）。

  macOS / Linux 装一条命令：
      curl -fsSL https://bun.sh/install | bash
  然后重开一个终端，再跑一次本脚本。

  Windows 用 PowerShell：
      powershell -c "irm bun.sh/install.ps1 | iex"

EOF
  die "缺少 Bun，已停止。"
fi

say "Bun $(bun --version)"

# --- 2. 依赖 ----------------------------------------------------------------
say "安装依赖（第一次会久一点）"
bun install

# --- 3. 配置 ----------------------------------------------------------------
if [ "$MODE" = "multi" ]; then
  if [ ! -f .env ]; then
    cp .env.example .env
    CODE="$(tr -dc 'a-zA-Z0-9' < /dev/urandom 2>/dev/null | head -c 8 || true)"
    # 就地改三项：开多人、开注册、监听所有网卡、写邀请码
    sed -i.bak 's/^VW_MULTI_USER=0/VW_MULTI_USER=1/' .env
    sed -i.bak 's/^VW_ALLOW_REGISTER=0/VW_ALLOW_REGISTER=1/' .env
    sed -i.bak 's/^VW_HOST=127.0.0.1/VW_HOST=0.0.0.0/' .env
    sed -i.bak "s|^# VW_REGISTER_CODE=.*|VW_REGISTER_CODE=${CODE}|" .env
    rm -f .env.bak
    say "已生成 .env（多人模式）。邀请码：${CODE}"
  else
    say "沿用已有的 .env"
    grep -q '^VW_MULTI_USER=1' .env || say "提醒：.env 里 VW_MULTI_USER 不是 1，现在还是单机模式"
  fi
else
  say "单机模式：不需要登录，打开就能用"
  [ -f .env ] || say "想改端口/站点名，把 .env.example 复制成 .env 再改"
fi

# --- 4. 构建前端 -------------------------------------------------------------
say "编译网页"
bun run --filter=@vw/web build

# --- 5. 启动 ----------------------------------------------------------------
if [ "$MODE" = "multi" ]; then
  HOST_SHOWN="$(grep -E '^VW_HOST=' .env 2>/dev/null | cut -d= -f2 || true)"
  PORT_SHOWN="$(grep -E '^VW_PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
  IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  say "启动中。别人访问：http://${IP:-服务器IP}:${PORT_SHOWN:-4780}"
  say "第一个注册的账号会自动成为管理员"
else
  say "启动中。浏览器打开 http://127.0.0.1:4780"
fi
say "按 Ctrl+C 停止"

exec bun apps/server/src/index.ts
