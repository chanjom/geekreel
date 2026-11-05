/**
 * 站点品牌。默认值在构建时就写死在包里，运行时由 /api/auth/config 覆盖，
 * 所以换名字不需要重新编译：改 .env 里的 VW_SITE_NAME 重启即可。
 *
 * 要改默认值（比如做成自己的发行版），跑 `bun scripts/rebrand.ts`。
 */
const FALLBACK_NAME = "GeekReel";
const FALLBACK_TAGLINE = "AI Studio";

let name = FALLBACK_NAME;
let tagline = FALLBACK_TAGLINE;

export function siteName(): string {
  return name;
}

export function siteTagline(): string {
  return tagline;
}

export function siteTitle(): string {
  return tagline ? `${name} · ${tagline}` : name;
}

/** 由 AuthProvider 在拿到配置后调用；同时把浏览器标题换掉 */
export function setSiteBrand(next: { name?: string; tagline?: string }) {
  if (next.name && next.name.trim()) name = next.name.trim();
  // 副标题允许显式传空：那是「不要显示这一行」的意思，不能回落到默认值
  if (next.tagline !== undefined) tagline = next.tagline.trim();
  if (typeof document !== "undefined") document.title = siteTitle();
}
