import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

export const version = "0.1.2";
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

/** 全局数据目录：SQLite、缓存等 */
export const dataDir = process.env.VW_DATA_DIR ?? join(homedir(), ".video-workbench");
mkdirSync(dataDir, { recursive: true });

export const dbPath = join(dataDir, "vw.db");

/** 资产库默认根目录（用户可在设置中更改） */
export const defaultLibraryRoot = join(homedir(), "VideoWorkbench");

/** web 构建产物（生产模式下由 server 托管） */
export const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
