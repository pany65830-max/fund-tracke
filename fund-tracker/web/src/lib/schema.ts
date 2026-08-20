import { z } from "zod";

export const InstitutionSchema = z.enum([
  "huaxia",
  "efunds",
  "guotai",
  "huatai",
  "sse",
  "szse",
  "media",
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

export const NewsItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().default(""),
  body: z.string().optional(),
  institution: InstitutionSchema,
  category: NewsCategorySchema,
  source: z.enum(["ifind", "wechat", "exchange_web", "company_web"]),
  publishedAt: z.string(),
  sourceUrl: z.string(),
  coverUrl: z.string().optional(),
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

export const DaySnapshotSchema = z.object({
  tradeDate: z.string(),
  updatedAt: z.string(),
  status: z.enum(["ok", "partial", "failed"]),
  errors: z.array(z.string()).optional(),
  news: z.array(NewsItemSchema),
  etf: z.object({
    indices: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        last: z.number(),
        changePct: z.number(),
      }),
    ),
    sectors: z.array(z.object({ name: z.string(), changePct: z.number() })),
    hotInflow: z.array(z.any()),
    hotGainers: z.array(z.any()),
    hotTurnover: z.array(z.any()),
    productsByFirm: z.record(
      z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          changePct: z.number(),
          amount: z.number().optional(),
          nav: z.number().optional(),
          amplitude: z.number().optional(),
          volume: z.number().optional(),
          shares: z.number().optional(),
        }),
      ),
    ),
  }),
});
export type DaySnapshot = z.infer<typeof DaySnapshotSchema>;
