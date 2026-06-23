/**
 * Token 成本拆解：定价表 + 计算逻辑。
 * 1:1 移植自 claude-inspector（public/index.html，定价基准日 2026-03-24）。
 * 单价单位：USD / MTok。
 */

export const PRICING_DATE = "2026-03-24";

export interface ModelPrice {
  input: number;
  output: number;
}

/** 按模型名匹配单价（includes 匹配，与原版一致）。 */
export function priceFor(model: string): ModelPrice {
  const m = (model || "").toLowerCase();
  if (m.includes("haiku")) return { input: 1, output: 5 };
  if (m.includes("opus")) {
    // opus 4.1 / 4.0 是旧高价；其余 opus（4.5/4.6 等）为新价
    if (m.includes("opus-4-1") || m.includes("opus-4-0")) {
      return { input: 15, output: 75 };
    }
    return { input: 5, output: 25 };
  }
  // 默认 Sonnet
  return { input: 3, output: 15 };
}

export interface UsageTokens {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface CostRow {
  label: string;
  tokens: number;
  /** 该项单价 USD/MTok */
  price: number;
  /** 该项成本 USD */
  cost: number;
}

export interface CostBreakdown {
  model: string;
  rows: CostRow[];
  total: number;
  /** 缓存命中率 % */
  cachePct: number;
  totalInput: number;
  output: number;
  isApiKey: boolean;
}

/**
 * 计算成本拆解。
 * 缓存计价：API → 读 10% 输入价、写 125% 输入价；订阅 → 读免费、写 = 输入价。
 */
export function computeCost(
  model: string,
  usage: UsageTokens | undefined,
  isApiKey: boolean,
): CostBreakdown | null {
  if (!usage) return null;
  const { input, output } = priceFor(model);
  const crP = isApiKey ? input * 0.1 : 0;
  const cwP = isApiKey ? input * 1.25 : input;

  const uncached = usage.input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  const totalInput = uncached + cacheRead + cacheWrite;

  const rows: CostRow[] = [
    {
      label: "cacheRead",
      tokens: cacheRead,
      price: crP,
      cost: (cacheRead * crP) / 1_000_000,
    },
    {
      label: "cacheWrite",
      tokens: cacheWrite,
      price: cwP,
      cost: (cacheWrite * cwP) / 1_000_000,
    },
    {
      label: "uncachedInput",
      tokens: uncached,
      price: input,
      cost: (uncached * input) / 1_000_000,
    },
    {
      label: "output",
      tokens: outTok,
      price: output,
      cost: (outTok * output) / 1_000_000,
    },
  ];
  const total = rows.reduce((s, r) => s + r.cost, 0);
  const cachePct =
    totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;

  return {
    model,
    rows,
    total,
    cachePct,
    totalInput,
    output: outTok,
    isApiKey,
  };
}

/** 从响应体提取 usage（流式响应已在代理层重建为完整 message，含 usage）。 */
export function extractUsage(responseBody: unknown): UsageTokens | undefined {
  if (!responseBody || typeof responseBody !== "object") return undefined;
  const usage = (responseBody as { usage?: UsageTokens }).usage;
  return usage && typeof usage === "object" ? usage : undefined;
}

/** 紧凑 token 显示：1234 → 1.2K，1200000 → 1.2M。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
