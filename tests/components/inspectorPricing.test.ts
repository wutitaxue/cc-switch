import { describe, it, expect } from "vitest";
import {
  priceFor,
  computeCost,
  formatTokens,
  extractUsage,
} from "@/components/inspector/lib/pricing";

describe("priceFor", () => {
  it("matches haiku / sonnet / opus tiers", () => {
    expect(priceFor("claude-haiku-4-5")).toEqual({ input: 1, output: 5 });
    expect(priceFor("claude-sonnet-4-6")).toEqual({ input: 3, output: 15 });
    expect(priceFor("claude-opus-4-6")).toEqual({ input: 5, output: 25 });
    // 旧高价 opus
    expect(priceFor("claude-opus-4-1")).toEqual({ input: 15, output: 75 });
  });
});

describe("computeCost", () => {
  it("returns null without usage", () => {
    expect(computeCost("sonnet", undefined, true)).toBeNull();
  });

  it("API pricing: cache read 10%, write 125% of input", () => {
    const c = computeCost(
      "claude-sonnet",
      {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      },
      true,
    )!;
    // input=3 → uncached 3, cacheRead 0.3, cacheWrite 3.75, output 15
    expect(c.total).toBeCloseTo(3 + 0.3 + 3.75 + 15, 5);
    expect(c.cachePct).toBe(33); // 1M / 3M
  });

  it("subscription pricing: cache read free, write = input price", () => {
    const c = computeCost(
      "claude-sonnet",
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
      },
      false,
    )!;
    // cacheRead 0, cacheWrite = input price 3
    expect(c.total).toBeCloseTo(3, 5);
  });
});

describe("formatTokens", () => {
  it("formats K and M", () => {
    expect(formatTokens(500)).toBe("500");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(2_500_000)).toBe("2.5M");
  });
});

describe("extractUsage", () => {
  it("pulls usage object from response body", () => {
    expect(extractUsage({ usage: { input_tokens: 5 } })).toEqual({
      input_tokens: 5,
    });
    // 流式响应在代理层已重建为完整 message，usage 直接可读
    expect(
      extractUsage({ model: "claude-opus-4-8", usage: { output_tokens: 12 } }),
    ).toEqual({ output_tokens: 12 });
    expect(extractUsage({ content: [] })).toBeUndefined();
    expect(extractUsage(null)).toBeUndefined();
  });
});
