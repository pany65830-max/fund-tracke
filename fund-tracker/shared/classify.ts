import type { Institution, NewsCategory } from "./schema.js";

type Rules = Record<"disclosure" | "active_etf" | "new_product" | "research", string[]>;

const DEFAULT_RULES: Rules = {
  disclosure: ["招募说明书", "公告", "信披", "份额变动", "上市交易"],
  active_etf: ["主动ETF", "主动管理ETF", "主动型ETF"],
  new_product: ["发行", "认购", "募集", "新品", "发售"],
  research: ["研报", "策略会", "月报", "季报观点", "投资观点"],
};

/** More specific categories before broad ones like 公告→disclosure. */
const ORDER: Array<keyof Rules> = [
  "active_etf",
  "new_product",
  "research",
  "disclosure",
];

export function classifyNews(
  input: {
    title: string;
    summary?: string;
    institution: Institution;
    sourceHint?: string;
  },
  rules: Rules = DEFAULT_RULES,
): NewsCategory {
  if (input.institution === "sse" || input.institution === "szse") {
    return "exchange";
  }
  if (input.institution === "media") {
    return "other";
  }
  const text = `${input.title}\n${input.summary ?? ""}`;
  for (const key of ORDER) {
    for (const kw of rules[key]) {
      if (text.includes(kw)) return key;
    }
  }
  return "other";
}
