export type PowerBiEmbedConfig = {
  configured: true;
  reportId: string;
  embedUrl: string;
  embedToken: string;
  tokenType: "Embed";
  expiresAt: string;
  datasetId?: string;
};

/** 后端签发的 Superset guest token 视图：只含前端渲染必需的字段 */
export type SupersetGuestToken = {
  dashboardId: string;
  supersetDomain: string;
  guestToken: string;
  expiresInSeconds: number;
};

export type AnalyticsProviderId = "superset" | "powerbi";

export type AnalyticsProviders = {
  providers: {
    superset: { configured: boolean; dashboardId?: string; supersetDomain?: string };
    powerbi: { configured: boolean };
  };
  defaultProvider: AnalyticsProviderId | null;
};
