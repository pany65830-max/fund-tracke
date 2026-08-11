import { z } from "zod";

export const InstitutionSchema = z.enum([
  "huaxia",
  "efunds",
  "guotai",
  "huatai",
  "sse",
  "szse",
]);
export type Institution = z.infer<typeof InstitutionSchema>;

export const NewsCategorySchema = z.enum([
  "research",
  "new_product",
  "active_etf",
  "disclosure",
  "exchange",
  "other",
]);
export type NewsCategory = z.infer<typeof NewsCategorySchema>;

export const NewsSourceSchema = z.enum(["ifind", "wechat", "exchange_web", "company_web"]);
export type NewsSource = z.infer<typeof NewsSourceSchema>;

export const NewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().default(""),
  body: z.string().optional(),
  institution: InstitutionSchema,
  category: NewsCategorySchema,
  source: NewsSourceSchema,
  publishedAt: z.string().min(1),
  sourceUrl: z.string().url(),
  coverUrl: z.string().url().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const IndexCardSchema = z.object({
  code: z.string(),
  name: z.string(),
  last: z.number(),
  changePct: z.number(),
});

export const SectorCellSchema = z.object({
  name: z.string(),
  changePct: z.number(),
});

export const EtfRankItemSchema = z.object({
  code: z.string(),
  name: z.string(),
  institution: InstitutionSchema,
  value: z.number(),
  unit: z.enum(["yi", "pct", "yi_amount"]).default("yi"),
});

export const EtfProductSchema = z.object({
  code: z.string(),
  name: z.string(),
  changePct: z.number(),
  volume: z.number().optional(),
  amount: z.number().optional(),
  shares: z.number().optional(),
  nav: z.number().optional(),
  amplitude: z.number().optional(),
});

export const EtfDashboardSchema = z.object({
  indices: z.array(IndexCardSchema),
  sectors: z.array(SectorCellSchema),
  hotInflow: z.array(EtfRankItemSchema),
  hotGainers: z.array(EtfRankItemSchema),
  hotTurnover: z.array(EtfRankItemSchema),
  productsByFirm: z.record(z.array(EtfProductSchema)),
});
export type EtfDashboard = z.infer<typeof EtfDashboardSchema>;

export const DaySnapshotSchema = z.object({
  tradeDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  updatedAt: z.string().min(1),
  status: z.enum(["ok", "partial", "failed"]),
  errors: z.array(z.string()).optional(),
  news: z.array(NewsItemSchema),
  etf: EtfDashboardSchema,
});
export type DaySnapshot = z.infer<typeof DaySnapshotSchema>;
