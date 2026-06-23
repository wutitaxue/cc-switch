//! Inspector（流量检查器）命令层
//!
//! 读取/控制全局内存捕获缓冲（`proxy::capture`）。不落盘。

use crate::proxy::capture::{self, CaptureRecord, CAPTURE_MAX};

/// 取最近捕获的流量（newest-first，最多 CAPTURE_MAX 条）。
#[tauri::command]
pub fn get_captured_traffic() -> Vec<CaptureRecord> {
    capture::buffer().recent(CAPTURE_MAX)
}

/// 清空捕获缓冲。
#[tauri::command]
pub fn clear_captured_traffic() -> bool {
    capture::buffer().clear();
    true
}

/// 开关捕获（默认随代理开启即捕获）。
#[tauri::command]
pub fn set_traffic_capture_enabled(enabled: bool) -> bool {
    capture::buffer().set_enabled(enabled);
    enabled
}

/// 查询捕获是否开启。
#[tauri::command]
pub fn get_traffic_capture_enabled() -> bool {
    capture::buffer().is_enabled()
}
