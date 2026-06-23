//! 流量捕获模块（Traffic Inspector）
//!
//! 旁路捕获代理转发的请求/响应 body，存内存环形缓冲（最近 `CAPTURE_MAX` 条），
//! 供前端 Inspector 页面实时查看。不落盘，重启即丢。
//!
//! - `push_request`：请求到达时先放一条（response 留空），返回 `id`。
//! - `attach_response`：响应就绪后按 `id` 补全。
//! - 两步之间通过 `id` 关联；超出容量时丢弃最旧。

use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

/// 内存最多保留的捕获记录条数（对标 claude-inspector 的 50）。
pub const CAPTURE_MAX: usize = 50;

/// 进程级全局捕获缓冲。代理 handler 与 inspector 命令共享同一份，
/// 不随代理重启而丢失引用。
static GLOBAL: OnceLock<TrafficCaptureBuffer> = OnceLock::new();

/// 获取全局捕获缓冲。
pub fn buffer() -> &'static TrafficCaptureBuffer {
    GLOBAL.get_or_init(TrafficCaptureBuffer::new)
}

/// 一条捕获记录（请求 + 可选响应）。字段以 camelCase 序列化给前端。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRecord {
    /// 单调递增 id（同时用于请求/响应关联）
    pub id: u64,
    /// 捕获时间（Unix 毫秒）
    pub ts: i64,
    /// 应用类型："claude" / "codex" / "gemini"
    pub app_type: String,
    /// 请求方法
    pub method: String,
    /// 请求路径
    pub path: String,
    /// 模型名（来自请求体）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// Session ID（用于前端按会话分组/着色）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// 选中的供应商 id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_id: Option<String>,
    /// 请求体（完整 JSON：model/system/messages/tools…）
    pub request_body: Value,
    /// 是否使用 API Key 鉴权（订阅 vs API，影响成本计价；不记录真实凭证）
    pub request_is_api_key: bool,
    /// 响应体（就绪后补全；流式为重组后的 Anthropic message JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_body: Option<Value>,
    /// 响应状态码（就绪后补全）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    /// 是否流式响应
    pub is_streaming: bool,
}

/// 流量捕获环形缓冲。
pub struct TrafficCaptureBuffer {
    buffer: Mutex<VecDeque<CaptureRecord>>,
    next_id: AtomicU64,
    enabled: AtomicBool,
}

impl Default for TrafficCaptureBuffer {
    fn default() -> Self {
        Self {
            buffer: Mutex::new(VecDeque::with_capacity(CAPTURE_MAX)),
            next_id: AtomicU64::new(1),
            // 默认随代理开启即捕获（对标 claude-inspector）
            enabled: AtomicBool::new(true),
        }
    }
}

impl TrafficCaptureBuffer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    /// 推入一条请求记录（response 留空），返回分配的 id。
    /// 调用方负责在捕获开启时才调用。
    #[allow(clippy::too_many_arguments)]
    pub fn push_request(
        &self,
        ts: i64,
        app_type: String,
        method: String,
        path: String,
        model: Option<String>,
        session_id: Option<String>,
        provider_id: Option<String>,
        request_body: Value,
        request_is_api_key: bool,
    ) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let record = CaptureRecord {
            id,
            ts,
            app_type,
            method,
            path,
            model,
            session_id,
            provider_id,
            request_body,
            request_is_api_key,
            response_body: None,
            status_code: None,
            is_streaming: false,
        };
        if let Ok(mut buf) = self.buffer.lock() {
            if buf.len() >= CAPTURE_MAX {
                buf.pop_front();
            }
            buf.push_back(record);
        }
        id
    }

    /// 按 id 补全响应。找不到（已被挤出）则忽略。返回补全后的记录副本（供 emit）。
    pub fn attach_response(
        &self,
        id: u64,
        status_code: u16,
        is_streaming: bool,
        response_body: Option<Value>,
    ) -> Option<CaptureRecord> {
        let mut buf = self.buffer.lock().ok()?;
        let record = buf.iter_mut().find(|r| r.id == id)?;
        record.status_code = Some(status_code);
        record.is_streaming = is_streaming;
        record.response_body = response_body;
        Some(record.clone())
    }

    /// 取最近 n 条（newest-first）。
    pub fn recent(&self, n: usize) -> Vec<CaptureRecord> {
        match self.buffer.lock() {
            Ok(buf) => buf.iter().rev().take(n).cloned().collect(),
            Err(_) => Vec::new(),
        }
    }

    /// 按 id 取单条副本（emit 新请求时用）。
    pub fn get(&self, id: u64) -> Option<CaptureRecord> {
        let buf = self.buffer.lock().ok()?;
        buf.iter().find(|r| r.id == id).cloned()
    }

    pub fn clear(&self) {
        if let Ok(mut buf) = self.buffer.lock() {
            buf.clear();
        }
    }
}

/// 流式 SSE 响应文本收集器：边转发边攒原始文本，流结束后取出。
///
/// 对标 `SseUsageCollector`，但只累积文本、不解析。用 `std::sync::Mutex`
/// （append 是快操作，无需 async 锁）。
#[derive(Clone, Default)]
pub struct SseResponseCollector {
    inner: std::sync::Arc<Mutex<String>>,
}

impl SseResponseCollector {
    pub fn new() -> Self {
        Self::default()
    }

    /// 追加一个 chunk 的文本。
    pub fn push_chunk(&self, chunk: &str) {
        if let Ok(mut s) = self.inner.lock() {
            // 防止异常流导致无限增长（单条响应上限 ~4MB 文本）
            const MAX: usize = 4 * 1024 * 1024;
            if s.len() < MAX {
                s.push_str(chunk);
            }
        }
    }

    /// 取出累积的完整 SSE 文本。
    pub fn take(&self) -> String {
        match self.inner.lock() {
            Ok(s) => s.clone(),
            Err(_) => String::new(),
        }
    }

    /// 取出并把累积的 SSE 文本重建成完整的 Anthropic message JSON。
    ///
    /// 对标 claude-inspector 的 `parseSseStream`：扫描 SSE 事件流，按
    /// `message_start` / `content_block_start` / `content_block_delta` /
    /// `content_block_stop` / `message_delta` 逐步重建出带 `content`、`usage`
    /// 等字段的 message 对象。无法解析则返回 `None`。
    pub fn take_reconstructed(&self) -> Option<Value> {
        let raw = self.take();
        if raw.is_empty() {
            return None;
        }
        reconstruct_sse_message(&raw)
    }
}

/// 把 SSE 文本重建成 Anthropic message 对象（对标 `parseSseStream`）。
fn reconstruct_sse_message(text: &str) -> Option<Value> {
    let mut msg: Option<Value> = None;
    let mut data_buf: Option<String> = None;

    let flush = |data: &str, msg: &mut Option<Value>| {
        let Ok(d) = serde_json::from_str::<Value>(data) else {
            return;
        };
        process_sse_event(&d, msg);
    };

    for raw_line in text.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some(rest) = line.strip_prefix("data:") {
            data_buf = Some(
                rest.strip_prefix(' ')
                    .unwrap_or(rest)
                    .trim_end()
                    .to_string(),
            );
        } else if line.is_empty() {
            if let Some(data) = data_buf.take() {
                flush(&data, &mut msg);
            }
        }
        // 其余字段（event: / id: 等）忽略，只关心 data 负载
    }
    if let Some(data) = data_buf.take() {
        flush(&data, &mut msg);
    }
    msg
}

/// 处理单个 SSE 事件，原地更新重建中的 message。
fn process_sse_event(d: &Value, msg: &mut Option<Value>) {
    let Some(event_type) = d.get("type").and_then(Value::as_str) else {
        return;
    };
    match event_type {
        "message_start" => {
            if let Some(m) = d.get("message") {
                let mut start = m.clone();
                if let Some(obj) = start.as_object_mut() {
                    obj.insert("_streaming".into(), Value::Bool(true));
                }
                *msg = Some(start);
            }
        }
        "content_block_start" => {
            if let (Some(msg), Some(idx), Some(block)) = (
                msg.as_mut(),
                d.get("index").and_then(Value::as_u64),
                d.get("content_block"),
            ) {
                let arr = ensure_content_array(msg, idx as usize);
                arr[idx as usize] = block.clone();
            }
        }
        "content_block_delta" => {
            let (Some(msg), Some(idx), Some(delta)) = (
                msg.as_mut(),
                d.get("index").and_then(Value::as_u64),
                d.get("delta"),
            ) else {
                return;
            };
            let Some(block) = msg
                .get_mut("content")
                .and_then(Value::as_array_mut)
                .and_then(|a| a.get_mut(idx as usize))
            else {
                return;
            };
            match delta.get("type").and_then(Value::as_str) {
                Some("text_delta") => {
                    append_str_field(block, "text", delta.get("text"));
                }
                Some("thinking_delta") => {
                    append_str_field(block, "thinking", delta.get("thinking"));
                }
                Some("input_json_delta") => {
                    append_str_field(block, "__partial_json", delta.get("partial_json"));
                }
                _ => {}
            }
        }
        "content_block_stop" => {
            if let (Some(msg), Some(idx)) = (msg.as_mut(), d.get("index").and_then(Value::as_u64)) {
                if let Some(block) = msg
                    .get_mut("content")
                    .and_then(Value::as_array_mut)
                    .and_then(|a| a.get_mut(idx as usize))
                    .and_then(Value::as_object_mut)
                {
                    if let Some(partial) = block
                        .remove("__partial_json")
                        .and_then(|v| v.as_str().map(str::to_string))
                    {
                        if !partial.is_empty() {
                            if let Ok(input) = serde_json::from_str::<Value>(&partial) {
                                block.insert("input".into(), input);
                            }
                        }
                    }
                }
            }
        }
        "message_delta" => {
            let Some(msg) = msg.as_mut() else { return };
            if let (Some(delta), Some(obj)) = (d.get("delta"), msg.as_object_mut()) {
                if let Some(delta_obj) = delta.as_object() {
                    for (k, v) in delta_obj {
                        obj.insert(k.clone(), v.clone());
                    }
                }
            }
            if let Some(usage) = d.get("usage") {
                merge_usage(msg, usage);
            }
        }
        _ => {}
    }
}

/// 确保 message.content 是长度 >= idx+1 的数组，返回其可变引用。
fn ensure_content_array(msg: &mut Value, idx: usize) -> &mut Vec<Value> {
    let obj = msg.as_object_mut().expect("message must be object");
    if !obj.get("content").map(Value::is_array).unwrap_or(false) {
        obj.insert("content".into(), Value::Array(Vec::new()));
    }
    let arr = obj
        .get_mut("content")
        .and_then(Value::as_array_mut)
        .expect("content is array");
    while arr.len() <= idx {
        arr.push(Value::Null);
    }
    arr
}

/// 把字符串增量追加到 block 的指定字段（不存在则创建）。
fn append_str_field(block: &mut Value, field: &str, delta: Option<&Value>) {
    let Some(piece) = delta.and_then(Value::as_str) else {
        return;
    };
    let Some(obj) = block.as_object_mut() else {
        return;
    };
    let cur = obj
        .get(field)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    obj.insert(field.into(), Value::String(cur + piece));
}

/// 把 message_delta 携带的 usage 合并进 message.usage。
fn merge_usage(msg: &mut Value, usage: &Value) {
    let Some(obj) = msg.as_object_mut() else {
        return;
    };
    let merged = obj
        .entry("usage")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    if let (Some(merged_obj), Some(usage_obj)) = (merged.as_object_mut(), usage.as_object()) {
        for (k, v) in usage_obj {
            merged_obj.insert(k.clone(), v.clone());
        }
    }
}

/// 前端监听的流量捕获事件名。
pub const EVENT_TRAFFIC_CAPTURED: &str = "traffic-captured";

/// 向前端实时推送一条捕获记录（新请求或响应补全后）。
/// 复用 usage_events 注入的全局 AppHandle；未注入时静默放弃。无防抖。
pub fn notify_traffic_captured(record: &CaptureRecord) {
    use tauri::Emitter;
    let Some(handle) = crate::usage_events::app_handle() else {
        return;
    };
    if let Err(e) = handle.emit(EVENT_TRAFFIC_CAPTURED, record) {
        log::warn!("emit {EVENT_TRAFFIC_CAPTURED} 失败: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn push(buf: &TrafficCaptureBuffer, n: u64) -> u64 {
        buf.push_request(
            n as i64,
            "claude".into(),
            "POST".into(),
            "/v1/messages".into(),
            Some("claude-sonnet".into()),
            Some("sess-1".into()),
            Some("prov-1".into()),
            json!({ "model": "claude-sonnet" }),
            true,
        )
    }

    #[test]
    fn ring_buffer_caps_at_max_and_drops_oldest() {
        let buf = TrafficCaptureBuffer::new();
        let mut ids = Vec::new();
        for i in 0..(CAPTURE_MAX as u64 + 5) {
            ids.push(push(&buf, i));
        }
        let recent = buf.recent(1000);
        assert_eq!(recent.len(), CAPTURE_MAX);
        // 最旧 5 条应已被挤出（前 5 个 id 不在缓冲里）
        for old in ids.iter().take(5) {
            assert!(buf.get(*old).is_none(), "old id {old} should be evicted");
        }
        // newest-first：第一条是最后 push 的
        assert_eq!(recent[0].id, *ids.last().unwrap());
    }

    #[test]
    fn attach_response_fills_record() {
        let buf = TrafficCaptureBuffer::new();
        let id = push(&buf, 1);
        let updated = buf
            .attach_response(id, 200, true, Some(json!({ "ok": true })))
            .expect("record exists");
        assert_eq!(updated.status_code, Some(200));
        assert!(updated.is_streaming);
        assert_eq!(updated.response_body, Some(json!({ "ok": true })));
    }

    #[test]
    fn attach_response_missing_id_is_ignored() {
        let buf = TrafficCaptureBuffer::new();
        assert!(buf.attach_response(999, 200, false, None).is_none());
    }

    #[test]
    fn enabled_toggle() {
        let buf = TrafficCaptureBuffer::new();
        assert!(buf.is_enabled());
        buf.set_enabled(false);
        assert!(!buf.is_enabled());
    }

    #[test]
    fn sse_response_collector_accumulates() {
        let c = SseResponseCollector::new();
        c.push_chunk("data: a\n\n");
        c.push_chunk("data: b\n\n");
        assert_eq!(c.take(), "data: a\n\ndata: b\n\n");
    }

    #[test]
    fn reconstruct_rebuilds_message_with_usage_and_text() {
        let sse = concat!(
            "event: message_start\n",
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-opus-4-8\",\"usage\":{\"input_tokens\":100,\"cache_read_input_tokens\":40}}}\n\n",
            "event: content_block_start\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello \"}}\n\n",
            "event: content_block_delta\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"world\"}}\n\n",
            "event: content_block_stop\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: message_delta\n",
            "data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":12}}\n\n",
        );
        let c = SseResponseCollector::new();
        c.push_chunk(sse);
        let msg = c.take_reconstructed().expect("reconstructed message");

        assert_eq!(msg["model"], "claude-opus-4-8");
        assert_eq!(msg["content"][0]["text"], "Hello world");
        assert_eq!(msg["stop_reason"], "end_turn");
        // message_start 的 usage 与 message_delta 的 usage 合并
        assert_eq!(msg["usage"]["input_tokens"], 100);
        assert_eq!(msg["usage"]["cache_read_input_tokens"], 40);
        assert_eq!(msg["usage"]["output_tokens"], 12);
    }

    #[test]
    fn reconstruct_assembles_tool_use_input_json() {
        let sse = concat!(
            "data: {\"type\":\"message_start\",\"message\":{\"id\":\"m\",\"model\":\"x\"}}\n\n",
            "data: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"Read\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\":\"}}\n\n",
            "data: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"/tmp/a\\\"}\"}}\n\n",
            "data: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
        );
        let c = SseResponseCollector::new();
        c.push_chunk(sse);
        let msg = c.take_reconstructed().expect("reconstructed message");
        assert_eq!(msg["content"][0]["name"], "Read");
        assert_eq!(msg["content"][0]["input"]["path"], "/tmp/a");
        // __partial_json 应已被清理
        assert!(msg["content"][0].get("__partial_json").is_none());
    }

    #[test]
    fn reconstruct_empty_returns_none() {
        let c = SseResponseCollector::new();
        assert!(c.take_reconstructed().is_none());
    }
}
