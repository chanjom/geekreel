import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// 先读仓库根目录的 .env，再读环境变量。
// 这样 `bun apps/server/src/index.ts` 从任何目录启动都能拿到配置，
// 用户只需改仓库根那一个文件，不用记 export。
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

function loadDotEnv(): void {
  const p = join(repoRoot, ".env");
  if (!existsSync(p)) return;
  let text = "";
  try {
    text = readFileSync(p, "utf-8");
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // 真实环境变量优先：容器编排里注入的不会被 .env 覆盖
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

export const repoDir = repoRoot;

export const version = "0.2.0";
export const port = Number(process.env.VW_PORT ?? 4780);
export const host = process.env.VW_HOST ?? "127.0.0.1";

/**
 * 多人模式。关闭时（默认）不登录，本机即管理员，数据全归本地账号；
 * 开启后所有 /api 需要登录，数据按 ownerId 隔离。对外部署必须开。
 */
export const multiUser = process.env.VW_MULTI_USER === "1";

/** 是否允许自助注册；关掉就只能由管理员在后台建号 */
export const allowRegister = process.env.VW_ALLOW_REGISTER === "1";

/** 注册邀请码，设了就要求注册时填写 */
export const registerCode = (process.env.VW_REGISTER_CODE ?? "").trim();

/** 会话有效期（天） */
export const sessionDays = Math.max(1, Number(process.env.VW_SESSION_DAYS ?? 30));

/** 是否只允许 https cookie（挂在反代后面时设 1） */
export const secureCookie = process.env.VW_SECURE_COOKIE === "1";

/** 站点名：出现在登录页、侧栏、邮件标题、页面 title。改成自己的品牌名即可 */
export const siteName = (process.env.VW_SITE_NAME ?? "GeekReel").trim() || "GeekReel";

/** 副标题：品牌名下面那行小字。不需要就设成空字符串 */
export const siteTagline = (process.env.VW_SITE_TAGLINE ?? "AI Studio").trim();

/** 对外地址（https://your.domain）。用于拼邮件里的重置链接；不设则按请求头推断 */
export const publicUrl = (process.env.VW_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");

/** 注册后必须验证邮箱才能登录。需要同时配好 SMTP，否则没人收得到信 */
export const requireVerify = process.env.VW_REQUIRE_EMAIL_VERIFY === "1";

/** 发信配置。只支持 465(隐式 TLS) 与明文端口（25 / 本机 relay） */
export const smtp = {
  host: (process.env.VW_SMTP_HOST ?? "").trim(),
  port: Number(process.env.VW_SMTP_PORT ?? 465),
  user: (process.env.VW_SMTP_USER ?? "").trim(),
  pass: process.env.VW_SMTP_PASS ?? "",
  from: (process.env.VW_SMTP_FROM ?? "").trim(),
  secure: (process.env.VW_SMTP_TLS ?? "1") === "1",
};

/** 全局数据目录：SQLite、缓存等 */
export const dataDir = process.env.VW_DATA_DIR ?? join(homedir(), ".video-workbench");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "vw.db");

/** 资产库默认根目录（用户可在设置中更改）；容器里用 VW_LIBRARY_ROOT 指到挂载卷 */
export const defaultLibraryRoot = (process.env.VW_LIBRARY_ROOT ?? "").trim() || join(homedir(), "VideoWorkbench");

/** web 构建产物（生产模式下由 server 托管） */
export const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
