import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { Trash2, Radio, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useInspector } from "@/hooks/useInspector";
import type { CaptureRecord } from "@/lib/api/inspector";
import { JsonTreeView, type JumpTarget } from "./JsonTreeView";
import { MechanismChips } from "./MechanismChips";
import { CostBreakdown } from "./CostBreakdown";
import { AnatomyView } from "./AnatomyView";

/** 为 sessionId 生成稳定的左边框颜色 */
const SESSION_COLORS = [
  "#0A84FF",
  "#30D158",
  "#FF9F0A",
  "#BF5AF2",
  "#FF375F",
  "#64D2FF",
  "#FFD60A",
];
function sessionColor(sessionId?: string): string {
  if (!sessionId) return "transparent";
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) {
    h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  }
  return SESSION_COLORS[h % SESSION_COLORS.length];
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

function requestBytes(record: CaptureRecord): number {
  try {
    return new TextEncoder().encode(JSON.stringify(record.requestBody)).length;
  } catch {
    return 0;
  }
}

export function InspectorPage() {
  const { t } = useTranslation();
  const { captures, enabled, clear, setEnabled } = useInspector();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("request");
  const [jump, setJump] = useState<JumpTarget | null>(null);
  const [activeChip, setActiveChip] = useState<string | null>(null);

  const selected = useMemo(
    () => captures.find((c) => c.id === selectedId) ?? captures[0] ?? null,
    [captures, selectedId],
  );

  // chip 点击：切回请求 tab，并把跳转目标（带自增 nonce）传给 JSON 树
  const handleJump = (key: string, target: Omit<JumpTarget, "nonce">) => {
    setTab("request");
    setActiveChip(key);
    setJump((prev) => ({ ...target, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative h-full min-h-0"
    >
      <div className="absolute inset-0 flex flex-col px-6 pb-6">
        {/* 顶部控制栏 */}
        <div className="flex items-center justify-between py-3">
          <div>
            <h2 className="text-lg font-semibold">
              {t("inspector.title", { defaultValue: "流量检查器" })}
            </h2>
            <p className="text-xs text-muted-foreground">
              {t("inspector.subtitle", {
                defaultValue: "实时查看 Claude Code 发往 API 的请求与响应",
              })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Radio size={14} className={enabled ? "text-green-500" : ""} />
              <Switch
                checked={enabled}
                onCheckedChange={(v) => void setEnabled(v)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void clear()}
              disabled={captures.length === 0}
            >
              <Trash2 size={14} className="mr-1.5" />
              {t("inspector.clear", { defaultValue: "清空" })}
            </Button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 gap-4">
          {/* 左侧请求列表 */}
          <div className="w-72 shrink-0 rounded-lg border bg-card/50 backdrop-blur-sm flex flex-col min-h-0">
            <div className="px-3 py-2 text-xs text-muted-foreground border-b">
              {t("inspector.count", {
                count: captures.length,
                defaultValue: "{{count}} 条请求",
              })}
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {captures.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  {t("inspector.empty", {
                    defaultValue:
                      "暂无捕获。开启代理并使用 Claude Code 后将实时出现。",
                  })}
                </div>
              ) : (
                captures.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    style={{ borderLeftColor: sessionColor(c.sessionId) }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 border-l-[3px] border-b text-[11px] font-mono hover:bg-muted/50",
                      selected?.id === c.id && "bg-muted/70",
                    )}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-muted-foreground shrink-0">
                        {c.method}
                      </span>
                      <span className="truncate flex-1">{c.path}</span>
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          c.statusCode == null
                            ? "text-muted-foreground"
                            : c.statusCode < 400
                              ? "text-green-600 dark:text-green-400"
                              : "text-red-600 dark:text-red-400",
                        )}
                      >
                        {c.statusCode ?? "…"}
                      </span>
                      <span className="shrink-0 text-muted-foreground/70 tabular-nums">
                        {fmtTime(c.ts)}
                      </span>
                    </div>
                    {c.model && (
                      <div className="truncate text-[10px] text-muted-foreground/70 mt-0.5">
                        {c.model}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 min-h-0 rounded-lg border bg-card/50 backdrop-blur-sm flex flex-col">
            {!selected ? (
              <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
                {t("inspector.selectHint", {
                  defaultValue: "选择左侧一条请求查看详情",
                })}
              </div>
            ) : (
              <Tabs
                value={tab}
                onValueChange={setTab}
                className="flex flex-col flex-1 min-h-0"
              >
                <div className="flex items-center justify-between gap-2 p-3 border-b">
                  <TabsList>
                    <TabsTrigger value="request">
                      {t("inspector.tab.request", { defaultValue: "请求" })}
                    </TabsTrigger>
                    <TabsTrigger value="response">
                      {t("inspector.tab.response", { defaultValue: "响应" })}
                    </TabsTrigger>
                    <TabsTrigger value="anatomy">
                      {t("inspector.tab.anatomy", { defaultValue: "解剖" })}
                    </TabsTrigger>
                  </TabsList>
                  <div className="relative">
                    <Search
                      size={14}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("inspector.search", {
                        defaultValue: "搜索…",
                      })}
                      className="h-7 w-40 pl-7 text-xs"
                    />
                  </div>
                </div>

                <div className="px-3 py-2 border-b">
                  <CostBreakdown
                    model={selected.model ?? ""}
                    responseBody={selected.responseBody}
                    isApiKey={selected.requestIsApiKey}
                    requestBytes={requestBytes(selected)}
                  />
                </div>

                <TabsContent
                  value="request"
                  className="mt-0 data-[state=active]:flex flex-col flex-1 min-h-0"
                >
                  <MechanismChips
                    requestBody={selected.requestBody}
                    onJump={handleJump}
                    activeKey={activeChip}
                  />
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="p-3">
                      <JsonTreeView
                        data={selected.requestBody}
                        search={search}
                        jump={jump ?? undefined}
                      />
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="response"
                  className="mt-0 data-[state=active]:flex flex-col flex-1 min-h-0"
                >
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="p-3">
                      {selected.responseBody == null ? (
                        <div className="py-10 text-center text-xs text-muted-foreground">
                          {selected.isStreaming
                            ? t("inspector.streaming", {
                                defaultValue: "流式响应进行中或仅记录原始 SSE",
                              })
                            : t("inspector.noResponse", {
                                defaultValue: "暂无响应",
                              })}
                        </div>
                      ) : (
                        <JsonTreeView
                          data={selected.responseBody}
                          search={search}
                        />
                      )}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="anatomy"
                  className="mt-0 data-[state=active]:flex flex-col flex-1 min-h-0"
                >
                  <MechanismChips
                    requestBody={selected.requestBody}
                    onJump={handleJump}
                    activeKey={activeChip}
                  />
                  <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <AnatomyView requestBody={selected.requestBody} />
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
