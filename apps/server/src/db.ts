import { Database } from "bun:sqlite";
import { dbPath } from "./config";

/**
 * SQLite（bun:sqlite 直用，schema 稳定前不引入 ORM）。
 * 原则：媒体与文档在文件系统，库只存索引与状态。
 */
export const db = new Database(dbPath, { create: true });
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");

db.run(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  directory TEXT NOT NULL,
  coverAssetId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'import',
  projectId TEXT,
  durationMs INTEGER,
  width INTEGER,
  height INTEGER,
  sizeBytes INTEGER NOT NULL,
  thumbPath TEXT,
  proxyPath TEXT,
  metaJson TEXT NOT NULL DEFAULT '{}',
  createdAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)");
db.run("CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(createdAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  projectId TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  message TEXT,
  payloadJson TEXT NOT NULL DEFAULT '{}',
  resultJson TEXT,
  error TEXT,
  createdAt INTEGER NOT NULL,
  startedAt INTEGER,
  finishedAt INTEGER
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, createdAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  valueJson TEXT NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS model_endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  adapterType TEXT NOT NULL,
  capability TEXT NOT NULL,
  configJson TEXT NOT NULL DEFAULT '{}',
  webSearch INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  isDefault INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS canvas_docs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_canvas_project ON canvas_docs(projectId)");

db.run(`
CREATE TABLE IF NOT EXISTS radar_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ai-query',
  platform TEXT NOT NULL,
  queryTemplate TEXT NOT NULL,
  intervalMinutes INTEGER NOT NULL DEFAULT 360,
  endpointId TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  lastRunAt INTEGER,
  lastError TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS radar_items (
  id TEXT PRIMARY KEY,
  sourceId TEXT NOT NULL,
  title TEXT NOT NULL,
  platform TEXT NOT NULL,
  url TEXT,
  heat INTEGER NOT NULL,
  heatText TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  fetchedAt INTEGER NOT NULL
)`);
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_radar_items_hash ON radar_items(hash)");
db.run("CREATE INDEX IF NOT EXISTS idx_radar_items_fetched ON radar_items(fetchedAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS radar_subs (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  platformsJson TEXT NOT NULL DEFAULT '[]',
  heatThreshold INTEGER NOT NULL DEFAULT 60,
  quietStart INTEGER,
  quietEnd INTEGER,
  channelsJson TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS push_channels (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  configJson TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS push_logs (
  id TEXT PRIMARY KEY,
  subId TEXT,
  channelId TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS analysis_reports (
  id TEXT PRIMARY KEY,
  sourceUrl TEXT,
  videoAssetId TEXT,
  title TEXT NOT NULL,
  reportJson TEXT NOT NULL,
  framesJson TEXT NOT NULL DEFAULT '[]',
  transcript TEXT,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS remake_templates (
  id TEXT PRIMARY KEY,
  analysisId TEXT,
  name TEXT NOT NULL,
  slotsJson TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS remake_runs (
  id TEXT PRIMARY KEY,
  templateId TEXT NOT NULL,
  projectId TEXT,
  variablesJson TEXT NOT NULL,
  status TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL,
  templateId TEXT NOT NULL,
  packId TEXT,
  status TEXT NOT NULL,
  currentStep TEXT NOT NULL DEFAULT '',
  stateJson TEXT NOT NULL DEFAULT '{}',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);

db.run(`
CREATE TABLE IF NOT EXISTS model_usage (
  id TEXT PRIMARY KEY,
  endpointId TEXT,
  endpointName TEXT NOT NULL DEFAULT '',
  capability TEXT NOT NULL,
  projectId TEXT,
  jobType TEXT NOT NULL DEFAULT '',
  promptTokens INTEGER NOT NULL DEFAULT 0,
  completionTokens INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  audioChars INTEGER NOT NULL DEFAULT 0,
  videoSec REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_usage_created ON model_usage(createdAt DESC)");
db.run("CREATE INDEX IF NOT EXISTS idx_usage_endpoint ON model_usage(endpointId, createdAt DESC)");

function ensureColumn(table: string, column: string, ddl: string) {
  const cols = db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) db.run(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn("projects", "stylePackId", "stylePackId TEXT");
ensureColumn("projects", "paletteJson", "paletteJson TEXT");
ensureColumn("projects", "seriesId", "seriesId TEXT");
ensureColumn("projects", "episodeIndex", "episodeIndex INTEGER");
ensureColumn("model_endpoints", "vision", "vision INTEGER NOT NULL DEFAULT 0");
ensureColumn("analysis_reports", "wordsJson", "wordsJson TEXT");
ensureColumn("analysis_reports", "usedVision", "usedVision INTEGER NOT NULL DEFAULT 0");
ensureColumn("assets", "favorite", "favorite INTEGER NOT NULL DEFAULT 0");
ensureColumn("assets", "kind", "kind TEXT NOT NULL DEFAULT 'generic'");
ensureColumn("radar_items", "lastSeenAt", "lastSeenAt INTEGER");
db.run("CREATE INDEX IF NOT EXISTS idx_radar_items_heat ON radar_items(heat DESC, fetchedAt DESC)");

db.run(`
CREATE TABLE IF NOT EXISTS asset_tags (
  assetId TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (assetId, tag)
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag)");

db.run(`
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'drama',
  stylePackId TEXT,
  substyle TEXT,
  paletteJson TEXT,
  bibleJson TEXT,
  episodeCount INTEGER NOT NULL DEFAULT 0,
  lastProjectId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);

// ---------------------------------------------------------------------------
// 账号与会话（多人部署用；单机模式不登录时全部数据归 admin）
// ---------------------------------------------------------------------------

db.run(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  passwordHash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt INTEGER NOT NULL,
  lastLoginAt INTEGER
)`);
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(lower(email))");

db.run(`
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  ua TEXT,
  ip TEXT
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId)");
db.run("CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expiresAt)");

// 一次性令牌：重置密码 / 验证邮箱。存哈希不存原文，泄库也换不出链接。
db.run(`
CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  kind TEXT NOT NULL,
  createdAt INTEGER NOT NULL,
  expiresAt INTEGER NOT NULL,
  usedAt INTEGER
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(userId, kind)");
db.run("CREATE INDEX IF NOT EXISTS idx_auth_tokens_exp ON auth_tokens(expiresAt)");

// 导演模式：一句话 → 剧本 → 定妆 → 出片。每个阶段停下来等人确认。
db.run(`
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  ownerId TEXT,
  projectId TEXT,
  pipelineId TEXT,
  brief TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT NOT NULL,
  planJson TEXT NOT NULL DEFAULT '{}',
  stageJson TEXT NOT NULL DEFAULT '{}',
  budgetCents INTEGER NOT NULL DEFAULT 0,
  spentCents INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
)`);
db.run("CREATE INDEX IF NOT EXISTS idx_agent_owner ON agent_runs(ownerId, createdAt DESC)");

// 老库升级：邮箱验证状态，历史账号默认已验证
ensureColumn("users", "emailVerified", "emailVerified INTEGER NOT NULL DEFAULT 1");

// 归属：项目、端点、系列、分析报告各自属于一个用户
ensureColumn("projects", "ownerId", "ownerId TEXT");
ensureColumn("assets", "ownerId", "ownerId TEXT");
ensureColumn("jobs", "ownerId", "ownerId TEXT");
ensureColumn("model_endpoints", "ownerId", "ownerId TEXT");
ensureColumn("series", "ownerId", "ownerId TEXT");
ensureColumn("analysis_reports", "ownerId", "ownerId TEXT");
ensureColumn("model_usage", "userId", "userId TEXT");
db.run("CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId, createdAt DESC)");
db.run("CREATE INDEX IF NOT EXISTS idx_endpoints_owner ON model_endpoints(ownerId)");
db.run("CREATE INDEX IF NOT EXISTS idx_usage_user ON model_usage(userId, createdAt DESC)");

// ---------------------------------------------------------------------------
// 设置读写
// ---------------------------------------------------------------------------

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.query("SELECT valueJson FROM settings WHERE key = ?").get(key) as { valueJson: string } | null;
  if (!row) return fallback;
  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.run(
    "INSERT INTO settings (key, valueJson) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET valueJson = excluded.valueJson",
    [key, JSON.stringify(value)],
  );
}
