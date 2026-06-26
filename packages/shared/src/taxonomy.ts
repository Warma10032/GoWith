export const primaryShopCategories = [
  "中餐",
  "地方特色菜",
  "火锅",
  "烧烤",
  "海鲜",
  "自助餐",
  "小吃快餐",
  "粉面粥",
  "甜品饮品",
  "咖啡烘焙",
  "西餐",
  "日本料理",
  "韩国料理",
  "东南亚菜",
  "素食",
  "其他餐饮",
] as const;

export const secondaryCuisines = [
  "鲁菜",
  "粤菜",
  "潮汕菜",
  "客家菜",
  "川菜",
  "湘菜",
  "江浙菜",
  "东北菜",
  "西北菜",
  "云贵菜",
  "新疆菜",
  "清真菜",
  "家常菜",
  "私房菜",
  "农家菜",
  "创意菜",
] as const;

export const shopCategoryOptions = [
  ...primaryShopCategories,
  ...secondaryCuisines,
] as const;

export type PrimaryShopCategory = (typeof primaryShopCategories)[number];
export type SecondaryCuisine = (typeof secondaryCuisines)[number];
export type ShopCategoryOption = (typeof shopCategoryOptions)[number];
