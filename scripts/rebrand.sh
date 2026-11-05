#!/usr/bin/env bash
# 把这个项目改成你自己的产品（改名字、副标题、主题色、logo）。
#
#   ./scripts/rebrand.sh
#   ./scripts/rebrand.sh --name "鸭鸭短剧" --tagline "AI 短剧工厂" --color "#e05a3a"
#
# 不带参数会逐项问你。改完记得重编前端：bun run build
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "这台机器还没有装 Bun。先装："
  echo "  curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

exec bun scripts/rebrand.ts "$@"
