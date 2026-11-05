#!/usr/bin/env bun
/**
 * 换牌：把这个项目改成你自己的产品。
 *
 *   bun scripts/rebrand.ts --name "鸭鸭短剧" --tagline "AI 短剧工厂" --color "#e05a3a"
 *
 * 不改业务代码，只改品牌层：站点名、副标题、浏览器标题、主题色、logo、
 * 仓库 README 标题、可选地换成自己的包名。
 *
 * 只想临时改名、还要跟上游同步更新的话，别跑这个脚本——在 .env 里写
 * VW_SITE_NAME 就够了。
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync, statSync, rmSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { createInterface } from "node:readline/promises";

const ROOT = resolve(import.meta.dir, "..");

type Args = {
  name?: string;
  tagline?: string;
  title?: string;
  color?: string;
  logo?: string;
  slug?: string;
  yes: boolean;
  resetGit: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): Args {
  const a: Args = { yes: false, resetGit: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`参数 ${k} 少了值`);
      return v;
    };
    if (k === "--name") a.name = next();
    else if (k === "--tagline") a.tagline = next();
    else if (k === "--title") a.title = next();
    else if (k === "--color") a.color = next();
    else if (k === "--logo") a.logo = next();
    else if (k === "--slug") a.slug = next();
    else if (k === "--yes" || k === "-y") a.yes = true;
    else if (k === "--reset-git") a.resetGit = true;
    else if (k === "--help" || k === "-h") a.help = true;
    else fail(`不认识的参数：${k}`);
  }
  return a;
}

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const HELP = `
用法：bun scripts/rebrand.ts [选项]

  --name <名字>       产品名。例："鸭鸭短剧"（必填，除非交互输入）
  --tagline <副标题>  名字下面那行小字。例："AI 短剧工厂"。传 "" 表示不要
  --title <标题>      浏览器标签标题。默认 "<名字> · <副标题>"
  --color <#hex>      主题色。例：#e05a3a（默认沿用原来的琥珀金）
  --logo <图片路径>   替换界面 logo（推荐 512×512 的 jpg）
  --slug <包名>       改成 npm 包名风格的标识。例：yaya-drama
  --yes               不逐项确认，直接写
  --reset-git         清空 git 历史，变成全新的仓库（危险，会二次确认）

只改品牌层，不碰业务逻辑。改完要重新编译前端：bun run build
`;

/* ------------------------------------------------------------------ 颜色 */

function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) fail(`颜色要写成 #rrggbb，收到的是：${hex}`);
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.round(f(p, q, h + 1 / 3) * 255);
  const g = Math.round(f(p, q, h) * 255);
  const b = Math.round(f(p, q, h - 1 / 3) * 255);
  return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
}

const clamp = (v: number) => Math.min(0.95, Math.max(0.08, v));

/** 一个主色 → 四个主题里各自合适的 accent / accent-dim */
function palette(color: string) {
  const [h, s, l] = hexToHsl(color);
  return {
    dark: { accent: hslToHex(h, s, clamp(l)), dim: hslToHex(h, Math.min(1, s * 0.95), clamp(l * 0.55)) },
    light: { accent: hslToHex(h, Math.max(0.35, s * 0.9), clamp(l * 0.68)), dim: hslToHex(h, s * 0.7, clamp(l * 0.85)) },
    eye: { accent: hslToHex(h, Math.max(0.4, s * 0.85), clamp(l * 0.55)), dim: hslToHex(h, s * 0.7, clamp(l * 0.7)) },
  };
}

/* ------------------------------------------------------------------ 文件处理 */

function read(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(`找不到文件：${rel}`);
  return readFileSync(p, "utf8");
}

function write(rel: string, content: string) {
  writeFileSync(join(ROOT, rel), content, "utf8");
}

/** 逐行替换 CSS 里的 accent，按主题块给不同的明度 */
function recolorCss(css: string, color: string): string {
  const p = palette(color);
  let block: "theme" | "dark" | "light" | "eye" = "theme";
  return css
    .split("\n")
    .map((line) => {
      if (/^\s*html\[data-theme="light"\]/.test(line)) block = "light";
      else if (/^\s*html\[data-theme="eye"\]/.test(line)) block = "eye";
      else if (/^\s*html\[data-theme="dark"\]/.test(line)) block = "dark";
      else if (/^\s*@theme\s*\{/.test(line)) block = "theme";
      const set = block === "theme" ? p.dark : p[block];
      const indent = (line.match(/^\s*/) ?? [""])[0];
      if (/^\s*--color-accent-dim\s*:/.test(line)) return `${indent}--color-accent-dim: ${set.dim};`;
      if (/^\s*--color-accent\s*:/.test(line)) return `${indent}--color-accent: ${set.accent};`;
      return line;
    })
    .join("\n");
}

/** .env 里改写或追加一个变量，保留注释与顺序 */
function setEnv(text: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  // 只吃同一行里的 "#" 和空格，不能用 \s（会跨行把上一条注释也吞掉）
  const re = new RegExp(`^[#\\t ]*${key}=.*$`, "m");
  if (re.test(text)) return text.replace(re, line);
  const trimmed = text.replace(/\s*$/, "");
  return `${trimmed}\n${line}\n`;
}

function ensureEnv(name: string, tagline: string): string {
  const envPath = join(ROOT, ".env");
  let text: string;
  if (existsSync(envPath)) {
    text = readFileSync(envPath, "utf8");
  } else if (existsSync(join(ROOT, ".env.example"))) {
    text = readFileSync(join(ROOT, ".env.example"), "utf8");
  } else {
    text = "";
  }
  text = setEnv(text, "VW_SITE_NAME", name);
  text = setEnv(text, "VW_SITE_TAGLINE", tagline);
  writeFileSync(envPath, text, "utf8");
  return existsSync(envPath) ? ".env" : "";
}

/* ------------------------------------------------------------------ 主流程 */

const args = parseArgs(Bun.argv.slice(2));
if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q: string, dft?: string) => {
  const hint = dft ? `（回车用 ${dft}）` : "";
  const v = (await rl.question(`${q}${hint}：`)).trim();
  return v || dft || "";
};

let name = args.name;
if (!name) {
  if (args.yes) fail("--yes 模式不会提问，请用 --name 指定产品名");
  console.log("\n这个脚本会把项目改成你自己的产品。先回答几个问题，直接回车用默认值。\n");
  name = await ask("产品名", "我的短剧工作室");
}
name = name.trim();
if (!name) fail("产品名不能为空");

// --yes 表示「不问，缺的都用默认值」，避免在脚本 / CI 里卡住等输入
let tagline = args.tagline;
if (tagline === undefined) tagline = args.yes ? "AI Studio" : await ask("副标题（显示在产品名下面）", "AI 短剧工厂");
tagline = tagline.trim();

const title = (args.title ?? `${name}${tagline ? ` · ${tagline}` : ""}`).trim();

let color = args.color;
if (!color) color = args.yes ? "#f5b53f" : await ask("主题色 #rrggbb（回车保留原来的琥珀金）", "#f5b53f");
color = color.trim();
if (!/^#?[0-9a-fA-F]{6}$/.test(color)) fail(`主题色要写成 #rrggbb，收到的是：${color}`);
if (!color.startsWith("#")) color = `#${color}`;

let slug = args.slug;
if (slug === undefined) {
  slug = args.yes ? "" : await ask("仓库 / 包名（英文小写，可留空不改）", "");
}
slug = (slug ?? "").trim();

/* 变更计划 */
type Change = { file: string; note: string };
const changes: Change[] = [];

const cssNow = read("apps/web/src/index.css");
const cssNext = recolorCss(cssNow, color);
if (cssNext !== cssNow) changes.push({ file: "apps/web/src/index.css", note: `主题色 → ${color}（深/浅/护眼三套自动配明度）` });

const htmlNow = read("apps/web/index.html");
const htmlNext = htmlNow.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
if (htmlNext !== htmlNow) changes.push({ file: "apps/web/index.html", note: `浏览器标题 → ${title}` });

const siteNow = read("apps/web/src/lib/site.ts");
let siteNext = siteNow
  .replace(/^const FALLBACK_NAME = ".*";$/m, `const FALLBACK_NAME = ${JSON.stringify(name)};`)
  .replace(/^const FALLBACK_TAGLINE = ".*";$/m, `const FALLBACK_TAGLINE = ${JSON.stringify(tagline)};`);
if (siteNext !== siteNow) changes.push({ file: "apps/web/src/lib/site.ts", note: "前端默认品牌（接口拿不到配置时的兜底）" });

const readmeNow = read("README.md");
const readmeNext = readmeNow.replace(/^#\s+.*$/m, `# ${name}`);
if (readmeNext !== readmeNow) changes.push({ file: "README.md", note: `标题 → ${name}` });

let pkgNext: string | null = null;
if (slug) {
  const pkgNow = read("package.json");
  pkgNext = pkgNow.replace(/^(\s*)"name":\s*"[^"]*"/m, `$1"name": ${JSON.stringify(slug)}`);
  if (pkgNext !== pkgNow) changes.push({ file: "package.json", note: `包名 → ${slug}` });
}

const envPath = join(ROOT, ".env");
changes.push({ file: ".env", note: `VW_SITE_NAME=${name} / VW_SITE_TAGLINE=${tagline}` });

let logoPath: string | null = null;
if (args.logo) {
  logoPath = resolve(args.logo);
  if (!existsSync(logoPath)) fail(`找不到 logo：${args.logo}`);
  const size = statSync(logoPath).size;
  if (size > 4 * 1024 * 1024) fail("logo 太大了（>4MB），先压一下再传");
  changes.push({ file: "apps/web/public/logo.jpg", note: `替换成 ${basename(logoPath)}` });
}

console.log("\n将要做的改动：\n");
for (const c of changes) console.log(`  · ${c.file}\n      ${c.note}`);
console.log("");

if (!args.yes) {
  const v = (await rl.question("确认写入？(y/N) ")).trim().toLowerCase();
  if (v !== "y" && v !== "yes" && v !== "是") {
    rl.close();
    console.log("已取消，什么都没改。");
    process.exit(0);
  }
}

write("apps/web/src/index.css", cssNext);
write("apps/web/index.html", htmlNext);
write("apps/web/src/lib/site.ts", siteNext);
write("README.md", readmeNext);
if (pkgNext) write("package.json", pkgNext);
ensureEnv(name, tagline);
if (logoPath) copyFileSync(logoPath, join(ROOT, "apps/web/public/logo.jpg"));

if (args.resetGit) {
  console.log("\n清空 git 历史后，这个目录就不再和原仓库有关系了。");
  const v = (await rl.question("真的清空？原历史无法恢复 (type RESET) ")).trim();
  if (v === "RESET") {
    rmSync(join(ROOT, ".git"), { recursive: true, force: true });
    Bun.spawnSync({ cmd: ["git", "init", "-b", "main"], cwd: ROOT });
    console.log("✓ 已清空 .git 并重新 init（还没提交，记得 git add -A && git commit）");
  } else {
    console.log("- 跳过了清空 git");
  }
}

rl.close();

console.log(`
✓ 改完了。生效方式不一样，别搞混：

  立刻生效（重启服务即可，不重编）
    名字、副标题        → .env 里的 VW_SITE_NAME / VW_SITE_TAGLINE

  必须重编前端才生效
    主题色、浏览器标题、logo、README 第一行
        bun run build
        # Docker 部署：docker compose up -d --build

  重编后启动：
        bun apps/server/src/index.ts

  换 logo 的话，把 512×512 的 jpg 放到 apps/web/public/logo.jpg（或下次用 --logo 传）

还想改的（这些没法自动换，得手改）：
  · 登录页左侧营销文案   apps/web/src/components/authShell.tsx
  · README 正文里的介绍  按你的产品重写
  · 许可证               LICENSE 现在是 Unlicense，商用/闭源都行，换成你的也可以

${args.resetGit ? "" : "注意：.env 已被 .gitignore 忽略，换的只是本机。要让部署出去的站也用这个名字，把 VW_SITE_NAME 写进环境变量。"}
`);
