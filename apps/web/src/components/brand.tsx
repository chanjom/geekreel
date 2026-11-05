import { useAuth } from "../lib/auth";
import { siteName, siteTagline } from "../lib/site";

/**
 * 品牌标识。名字与副标题来自服务端配置（VW_SITE_NAME / VW_SITE_TAGLINE），
 * 所以同一个构建可以给不同站点用，不用重新编译。
 */
export function BrandMark(props: { size?: "sm" | "md" | "lg"; compact?: boolean; stacked?: boolean }) {
  const { config } = useAuth();
  const name = config?.siteName?.trim() || siteName();
  // 配置里明确给了空副标题，就是不显示；不能回落到内置默认值
  const tagline = (config ? config.siteTagline : siteTagline())?.trim() ?? "";
  const px = props.size === "lg" ? 56 : props.size === "md" ? 40 : 32;
  return (
    <div className={`flex items-center ${props.stacked ? "flex-col" : "gap-2.5"} ${props.compact ? "justify-center" : ""}`}>
      <img
        src="/logo.jpg"
        alt={name}
        width={px}
        height={px}
        className="shrink-0 rounded-xl object-cover"
        style={{ width: px, height: px }}
      />
      {!props.compact ? (
        <div className={props.stacked ? "mt-2 text-center" : "min-w-0"}>
          <div className="text-sm font-semibold leading-tight tracking-wide">{name}</div>
          {tagline ? <div className="text-[10px] text-fg-faint">{tagline}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
