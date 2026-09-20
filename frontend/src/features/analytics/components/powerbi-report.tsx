import { PowerBIEmbed } from "powerbi-client-react";
import { models, type Report } from "powerbi-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui/button.js";
import type { PowerBiEmbedConfig } from "../types.js";

type EmbedState = "loading" | "rendered" | "error";

function providerErrorMessage(event: unknown) {
  if (!event || typeof event !== "object") return "Power BI 报告加载失败";
  const detail = "detail" in event ? event.detail : undefined;
  if (!detail || typeof detail !== "object") return "Power BI 报告加载失败";
  if ("message" in detail && typeof detail.message === "string" && detail.message.trim()) return detail.message;
  if ("error" in detail && detail.error && typeof detail.error === "object" && "message" in detail.error && typeof detail.error.message === "string") {
    return detail.error.message;
  }
  return "Power BI 报告加载失败";
}

export function PowerBiReport({
  embedConfig,
  onTokenRefresh,
}: {
  embedConfig: PowerBiEmbedConfig;
  onTokenRefresh: () => void;
}) {
  const [embeddedConfig, setEmbeddedConfig] = useState(embedConfig);
  const [state, setState] = useState<EmbedState>("loading");
  const [errorMessage, setErrorMessage] = useState("Power BI 报告加载失败");
  const reportRef = useRef<Report | null>(null);
  const loadedRef = useRef(false);
  const tokenRef = useRef(embedConfig.embedToken);

  useEffect(() => {
    if (embedConfig.embedToken === tokenRef.current) return;
    if (!loadedRef.current || !reportRef.current) {
      tokenRef.current = embedConfig.embedToken;
      setEmbeddedConfig(embedConfig);
      setState("loading");
      return;
    }
    const report = reportRef.current;
    void report.setAccessToken(embedConfig.embedToken)
      .then(() => {
        tokenRef.current = embedConfig.embedToken;
      })
      .catch(() => {
        setState("error");
        setErrorMessage("分析报告凭证已失效，请刷新后重试");
      });
  }, [embedConfig]);

  const eventHandlers = useMemo(() => new Map<string, (event?: unknown) => void>([
    ["loaded", () => {
      loadedRef.current = true;
      setState("loading");
    }],
    ["rendered", () => setState("rendered")],
    ["error", (event) => {
      setState("error");
      setErrorMessage(providerErrorMessage(event));
    }],
    ["tokenExpired", () => onTokenRefresh()],
  ]), [onTokenRefresh]);

  return (
    <div className="relative h-full min-h-0" data-testid="powerbi-report">
      <PowerBIEmbed
        embedConfig={{
          type: "report",
          id: embeddedConfig.reportId,
          embedUrl: embeddedConfig.embedUrl,
          accessToken: tokenRef.current,
          tokenType: models.TokenType.Embed,
          settings: {
            background: models.BackgroundType.Transparent,
            filterPaneEnabled: false,
            navContentPaneEnabled: true,
          },
        }}
        cssClassName="h-full w-full"
        eventHandlers={eventHandlers}
        getEmbeddedComponent={(embeddedComponent) => {
          reportRef.current = embeddedComponent as Report;
        }}
      />
      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-surface/72 text-[13px] text-text-muted" role="status">
          正在加载经营分析…
        </div>
      )}
      {state === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-surface/88 p-6" role="alert">
          <div className="max-w-md text-center">
            <div className="text-sm font-semibold text-text-primary">分析报告加载失败</div>
            <p className="mt-1 text-xs text-text-muted">{errorMessage}</p>
            <Button className="mt-3" size="sm" variant="outline" onClick={() => {
              setState("loading");
              onTokenRefresh();
            }}>
              重试
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
