# GeekReel 多人部署镜像
# 构建：docker build -t geekreel .
# 运行：见 docker-compose.yml

FROM oven/bun:1.2-debian AS base

# ffmpeg / ffprobe 用系统包，避免依赖 ffmpeg-static 的平台差异
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json bun.lock bunfig.toml tsconfig.base.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/analyze/package.json ./packages/analyze/
COPY packages/core/package.json ./packages/core/
COPY packages/media/package.json ./packages/media/
COPY packages/models/package.json ./packages/models/
COPY packages/pipeline/package.json ./packages/pipeline/
COPY packages/push/package.json ./packages/push/
COPY packages/radar/package.json ./packages/radar/
COPY packages/remake/package.json ./packages/remake/
COPY packages/style/package.json ./packages/style/

RUN bun install

COPY . .

# 构建前端（产物由 server 托管，单端口对外）
RUN bun run --filter=@vw/web build

ENV NODE_ENV=production \
    VW_HOST=0.0.0.0 \
    VW_PORT=4780 \
    VW_DATA_DIR=/data \
    VW_MULTI_USER=1 \
    VW_ALLOW_REGISTER=1 \
    VW_SECURE_COOKIE=0

# 数据库、密钥、缓存
VOLUME ["/data"]
# 项目与素材落盘根目录
VOLUME ["/library"]

EXPOSE 4780

# 健康检查：容器自己探活，反代和编排都靠它
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4780/api/health || exit 1

CMD ["bun", "apps/server/src/index.ts"]
