import { useCallback, useEffect, useState } from "react";
import { useTauriEvent } from "./useTauriEvent";
import {
  inspectorApi,
  TRAFFIC_CAPTURED_EVENT,
  type CaptureRecord,
} from "@/lib/api/inspector";

const CAP = 50;

/**
 * 流量捕获实时数据源。
 * - 挂载时拉一次现有缓冲；
 * - 监听 `traffic-captured` 事件，按 id upsert（新请求插入、响应补全替换）；
 * - newest-first，上限 50 条（与后端一致）。
 */
export function useInspector() {
  const [captures, setCaptures] = useState<CaptureRecord[]>([]);
  const [enabled, setEnabledState] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [initial, en] = await Promise.all([
          inspectorApi.getCaptured(),
          inspectorApi.getEnabled(),
        ]);
        if (!active) return;
        setCaptures(initial);
        setEnabledState(en);
      } catch (error) {
        console.error("[useInspector] init failed", error);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useTauriEvent<CaptureRecord>(TRAFFIC_CAPTURED_EVENT, (record) => {
    setCaptures((prev) => {
      const idx = prev.findIndex((r) => r.id === record.id);
      if (idx >= 0) {
        // 响应补全：替换同 id 记录，保持原顺序
        const next = prev.slice();
        next[idx] = record;
        return next;
      }
      // 新请求：插到最前，截断到上限
      return [record, ...prev].slice(0, CAP);
    });
  });

  const clear = useCallback(async () => {
    await inspectorApi.clear();
    setCaptures([]);
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    await inspectorApi.setEnabled(next);
    setEnabledState(next);
  }, []);

  return { captures, enabled, clear, setEnabled };
}
