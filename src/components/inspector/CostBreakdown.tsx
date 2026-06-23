import { useTranslation } from "react-i18next";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  computeCost,
  extractUsage,
  formatTokens,
  PRICING_DATE,
} from "./lib/pricing";

interface CostBreakdownProps {
  model: string;
  responseBody: unknown;
  isApiKey: boolean;
  /** 请求体字节数（显示 KB） */
  requestBytes?: number;
}

/** token/成本徽标条 + 点开明细。 */
export function CostBreakdown({
  model,
  responseBody,
  isApiKey,
  requestBytes,
}: CostBreakdownProps) {
  const { t } = useTranslation();
  const usage = extractUsage(responseBody);
  const cost = computeCost(model, usage, isApiKey);

  if (!cost) {
    return requestBytes ? (
      <Badge variant="outline" className="text-[10px]">
        {(requestBytes / 1024).toFixed(1)} KB
      </Badge>
    ) : null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="flex flex-wrap items-center gap-1">
          {requestBytes ? (
            <Badge variant="outline" className="text-[10px]">
              {(requestBytes / 1024).toFixed(1)} KB
            </Badge>
          ) : null}
          <Badge variant="outline" className="text-[10px]">
            In {formatTokens(cost.totalInput)}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            Out {formatTokens(cost.output)}
          </Badge>
          {cost.cachePct > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] border-green-500 text-green-600 dark:text-green-400"
            >
              Cache {cost.cachePct}%
            </Badge>
          )}
          <Badge
            variant="outline"
            className="text-[10px] border-amber-500 text-amber-600 dark:text-amber-400"
          >
            ${cost.total.toFixed(4)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="space-y-2 text-xs">
          <div className="font-medium">{cost.model}</div>
          <table className="w-full">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal">
                  {t("inspector.cost.item", { defaultValue: "项目" })}
                </th>
                <th className="text-right font-normal">Tokens</th>
                <th className="text-right font-normal">$/MTok</th>
                <th className="text-right font-normal">
                  {t("inspector.cost.cost", { defaultValue: "成本" })}
                </th>
              </tr>
            </thead>
            <tbody>
              {cost.rows.map((r) => (
                <tr key={r.label}>
                  <td>{t(`inspector.cost.${r.label}`)}</td>
                  <td className="text-right">{formatTokens(r.tokens)}</td>
                  <td className="text-right">{r.price.toFixed(2)}</td>
                  <td className="text-right">${r.cost.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="border-t font-medium">
                <td colSpan={3}>
                  {t("inspector.cost.total", { defaultValue: "合计" })}
                </td>
                <td className="text-right">${cost.total.toFixed(4)}</td>
              </tr>
            </tbody>
          </table>
          <div className="text-muted-foreground">
            {cost.isApiKey
              ? t("inspector.cost.noteApi", { defaultValue: "🔑 API 计价" })
              : t("inspector.cost.noteSubscription", {
                  defaultValue: "🎫 订阅计价（缓存读免费）",
                })}
            {" · "}
            {t("inspector.cost.pricingDate", {
              date: PRICING_DATE,
              defaultValue: `价格基准 ${PRICING_DATE}`,
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
