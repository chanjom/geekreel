import { expect, test } from "bun:test";
import {
  buildFocusTemplate,
  buildPlatformSearchTemplate,
  fallbackStoryFromItem,
  inQuietHours,
  isDue,
  itemHash,
  matchSubscription,
  parseHttpItems,
  parseRadarResponse,
  parseRss,
  topicSearchUrl,
  fetchHotlist,
  hasHotlist,
  parseHotValue,
} from "./index";
import { heatTier, platformColor, relativeTime } from "@vw/core";

test("parseRadarResponse 能抠 markdown 围栏", () => {
  const items = parseRadarResponse(
    '废话\n```json\n{"items":[{"title":"A","platform":"微博","url":"https://weibo.com/x","heat":88,"heatText":"热搜第2","summary":"摘要"}]}\n```',
    "微博",
  );
  expect(items).toHaveLength(1);
  expect(items[0]!.title).toBe("A");
  expect(items[0]!.heat).toBe(88);
  expect(items[0]!.url).toContain("s.weibo.com/weibo?q=");
});

test("parseRadarResponse 热度夹紧 + 缺字段兜底", () => {
  const items = parseRadarResponse('{"items":[{"title":"B","heat":999}]}', "抖音");
  expect(items[0]!.heat).toBe(100);
  expect(items[0]!.platform).toBe("抖音");
  expect(items[0]!.url).toContain("douyin.com/search/");
});

test("topicSearchUrl 按平台拼可打开的搜索页", () => {
  expect(topicSearchUrl("微博", "#苹果免费换新#")).toContain("s.weibo.com/weibo?q=");
  expect(topicSearchUrl("知乎", "AI提示词")).toContain("zhihu.com/search?type=content");
  expect(topicSearchUrl("知乎", "AI提示词")).not.toContain("xxxxxx");
});

test("itemHash 对空白和大小写不敏感", () => {
  expect(itemHash("Hello  World", "微博", null)).toBe(itemHash("hello world", "微博", null));
});

test("isDue 按间隔判断", () => {
  expect(isDue(null, 60)).toBe(true);
  expect(isDue(Date.now() - 10 * 60_000, 60)).toBe(false);
  expect(isDue(Date.now() - 70 * 60_000, 60)).toBe(true);
});

test("inQuietHours 支持跨夜", () => {
  const sub = { quietStart: 22, quietEnd: 8 };
  expect(inQuietHours(sub, new Date("2026-10-04T23:00:00"))).toBe(true);
  expect(inQuietHours(sub, new Date("2026-10-04T07:00:00"))).toBe(true);
  expect(inQuietHours(sub, new Date("2026-10-04T12:00:00"))).toBe(false);
});

test("matchSubscription 关键词 + 热度 + 平台", () => {
  const item = { title: "武松打虎上热搜", summary: "网友讨论", platform: "微博", heat: 80 };
  expect(matchSubscription(item, { keyword: "武松", platforms: [], heatThreshold: 50, enabled: true })).toBe(true);
  expect(matchSubscription(item, { keyword: "武松", platforms: ["抖音"], heatThreshold: 50, enabled: true })).toBe(false);
  expect(matchSubscription(item, { keyword: "武松", platforms: [], heatThreshold: 90, enabled: true })).toBe(false);
  expect(matchSubscription(item, { keyword: "无关", platforms: [], heatThreshold: 10, enabled: true })).toBe(false);
});

test("buildFocusTemplate 注入领域", () => {
  expect(buildFocusTemplate("电商")).toContain("电商");
});

test("buildPlatformSearchTemplate 限定平台和词", () => {
  const t = buildPlatformSearchTemplate("微博", "AI");
  expect(t).toContain("微博");
  expect(t).toContain("AI");
});

test("parseRss 抽 item 标题和链接", () => {
  const items = parseRss(
    `<?xml version="1.0"?><rss><channel>
      <item><title>热搜A</title><link>https://weibo.com/a</link><description>摘要A</description></item>
      <item><title>热搜B</title><link>https://weibo.com/b</link></item>
    </channel></rss>`,
    "微博",
  );
  expect(items).toHaveLength(2);
  expect(items[0]!.title).toBe("热搜A");
  expect(items[0]!.url).toBe("https://weibo.com/a");
  expect(items[0]!.heat).toBeGreaterThan(items[1]!.heat);
});

test("parseHttpItems 认 items 数组", () => {
  const items = parseHttpItems(
    { items: [{ title: "接口热", url: "https://x.com/1", heat: 77, summary: "一句话" }] },
    "自定义",
  );
  expect(items[0]!.title).toBe("接口热");
  expect(items[0]!.heat).toBe(77);
});

test("fallbackStoryFromItem 把标题摘要收成可改的想法", () => {
  const idea = fallbackStoryFromItem({
    platform: "知乎",
    title: "午休健身算工伤吗",
    summary: "法院改判认定属预备性工作",
  });
  expect(idea).toContain("知乎");
  expect(idea).toContain("午休健身算工伤吗");
  expect(idea).toContain("法院改判认定属预备性工作");
});

test("hasHotlist 只认能直连榜单的平台", () => {
  expect(hasHotlist("B站")).toBe(true);
  expect(hasHotlist(" 抖音 ")).toBe(true);
  expect(hasHotlist("微博")).toBe(true);
  expect(hasHotlist("知乎")).toBe(true);
  expect(hasHotlist("小红书")).toBe(false);
});

test("fetchHotlist 对没有公开榜单的平台返回 null", async () => {
  expect(await fetchHotlist("小红书")).toBeNull();
  expect(await fetchHotlist("快手")).toBeNull();
});

test("parseHotValue 认得万/亿单位", () => {
  expect(parseHotValue("161万")).toBe(1_610_000);
  expect(parseHotValue("1198.8万")).toBe(11_988_000);
  expect(parseHotValue("1.2亿")).toBe(120_000_000);
  expect(parseHotValue("820")).toBe(820);
  expect(parseHotValue("")).toBe(0);
  expect(parseHotValue(undefined)).toBe(0);
});

test("热度分档与相对时间", () => {
  expect(heatTier(95)).toBe("hot");
  expect(heatTier(60)).toBe("warm");
  expect(heatTier(12)).toBe("cool");
  expect(relativeTime(null)).toBe("还没抓过");
  expect(relativeTime(Date.now() - 30_000)).toBe("刚刚");
  expect(relativeTime(Date.now() - 12 * 60_000)).toBe("12 分钟前");
  expect(relativeTime(Date.now() - 3 * 3600_000)).toBe("3 小时前");
  expect(relativeTime(Date.now() - 2 * 86400_000)).toBe("2 天前");
});

test("platformColor 有专属色，未知平台走默认灰", () => {
  expect(platformColor("微博")).not.toBe(platformColor("未知平台"));
  expect(platformColor("未知平台")).toBe("#8a909e");
});
