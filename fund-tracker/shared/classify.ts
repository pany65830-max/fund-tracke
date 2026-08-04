import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Institution, NewsCategory } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type Rules = Record<"disclosure" | "active_etf" | "new_product" | "research", string[]>;

function loadRules(): Rules {
  const path = join(__dirname, "../config/category-rules.json");
  return JSON.parse(readFileSync(path, "utf8")) as Rules;
}

/** More specific categories before broad ones like 公告→disclosure. */
const ORDER: Array<keyof Rules> = [
  "active_etf",
  "new_product",
  "research",
  "disclosure",
];

export function classifyNews(input: {
  title: string;
  summary?: string;
  institution: Institution;
  sourceHint?: string;
}): NewsCategory {
  if (input.institution === "sse" || input.institution === "szse") {
    return "exchange";
  }
  const text = `${input.title}\n${input.summary ?? ""}`;
  const rules = loadRules();
  for (const key of ORDER) {
    for (const kw of rules[key]) {
      if (text.includes(kw)) return key;
    }
  }
  return "other";
}
