/**
 * 大众点评搜索 URL 构造器。
 *
 * 仅构造 URL，不发起任何网络请求，符合 CLAUDE.md「不绕过反爬」政策。
 * admin 在店铺详情页点击按钮 → 新标签打开搜索结果 → 人工比对店名/地址/电话 →
 * 复制 /shop/<id> 直链粘回既有输入框，由 `parseDianpingUrl` 校验后入库。
 *
 * URL 规则（2026-06-23 调研）：
 *   https://www.dianping.com/search/keyword/<cityId>/0_<urlencoded店名>
 * "0_" 前缀是大众点评搜索服务的约定，不加的话会落到首页或搜不到结果。
 */

import { lookupDianpingCityId } from "@gowith/shared";

const DIANPING_SEARCH_BASE = "https://www.dianping.com/search/keyword";
const SHOP_NAME_PREFIX = "0_";

export function buildDianpingSearchUrl(
  cityName: string | null | undefined,
  shopName: string | null | undefined,
): string | null {
  if (!shopName || !shopName.trim()) return null;
  const cityId = lookupDianpingCityId(cityName);
  if (cityId === null) return null;
  return `${DIANPING_SEARCH_BASE}/${cityId}/${encodeURIComponent(
    `${SHOP_NAME_PREFIX}${shopName.trim()}`,
  )}`;
}
