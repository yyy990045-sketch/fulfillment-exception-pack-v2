export type PowerBiEmbedConfig = {
  configured: true;
  reportId: string;
  embedUrl: string;
  embedToken: string;
  tokenType: "Embed";
  expiresAt: string;
  datasetId?: string;
};
