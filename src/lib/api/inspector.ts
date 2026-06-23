import { invoke } from "@tauri-apps/api/core";

/** 一条捕获的流量记录（对应后端 CaptureRecord，camelCase） */
export interface CaptureRecord {
  id: number;
  /** Unix 毫秒 */
  ts: number;
  appType: string;
  method: string;
  path: string;
  model?: string;
  sessionId?: string;
  providerId?: string;
  /** 请求体（完整 JSON） */
  requestBody: unknown;
  /** 是否 API Key 鉴权（影响缓存计价；订阅为 false） */
  requestIsApiKey: boolean;
  /** 响应体（就绪后补全；流式已在代理层重建为完整 Anthropic message JSON） */
  responseBody?: unknown;
  statusCode?: number;
  isStreaming: boolean;
}

/** 前端监听的实时事件名（与后端 EVENT_TRAFFIC_CAPTURED 一致） */
export const TRAFFIC_CAPTURED_EVENT = "traffic-captured";

export const inspectorApi = {
  /** 取最近捕获的流量（newest-first） */
  async getCaptured(): Promise<CaptureRecord[]> {
    return await invoke("get_captured_traffic");
  },

  /** 清空捕获缓冲 */
  async clear(): Promise<boolean> {
    return await invoke("clear_captured_traffic");
  },

  /** 开关捕获 */
  async setEnabled(enabled: boolean): Promise<boolean> {
    return await invoke("set_traffic_capture_enabled", { enabled });
  },

  /** 查询捕获是否开启 */
  async getEnabled(): Promise<boolean> {
    return await invoke("get_traffic_capture_enabled");
  },
};
