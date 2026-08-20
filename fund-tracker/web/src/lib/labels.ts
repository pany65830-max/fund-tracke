import type { Institution, NewsCategory } from "./schema";

export const INSTITUTION_LABEL: Record<Institution, string> = {
  huaxia: "华夏",
  efunds: "易方达",
  guotai: "国泰",
  huatai: "华泰柏瑞",
  sse: "上交所",
  szse: "深交所",
  media: "中国证券报",
};

export const CATEGORY_LABEL: Record<NewsCategory, string> = {
  research: "研报",
  new_product: "新产品发行",
  active_etf: "主动ETF公告",
  disclosure: "一般信披",
  exchange: "交易所资讯",
  other: "其他",
};

export const SOURCE_LABEL = {
  ifind: "iFind",
  wechat: "微信",
  exchange_web: "交易所官网",
  company_web: "基金公司官网",
} as const;
