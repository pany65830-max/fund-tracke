import type { EtfDashboard, NewsItem } from "../../shared/schema.js";

export interface NewsAdapter {
  name: string;
  fetchNews(tradeDate: string): Promise<NewsItem[]>;
}

export interface EtfAdapter {
  name: string;
  fetchEtf(tradeDate: string): Promise<EtfDashboard>;
}
