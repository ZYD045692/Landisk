mod config;
mod logger;
mod middleware;
mod routes;

use axum::{
    Router,
    extract::{ConnectInfo, DefaultBodyLimit, Query, Request, State},
    http::{StatusCode, header},
    response::{IntoResponse, Json, Sse, sse::Event},
    routing::{delete, get, post, put},
};
use http_body_util::BodyDataStream;
use config::{Config, RootEntry};
use logger::{LogQuery, Logger};
use middleware::path_safety::resolve_safe_path;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::fs;
use std::path::Path;
use std::io::SeekFrom;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

/// 编译时间戳（build.rs 注入）：判断运行中的后端是否最新编译
/// 启动日志 + /api/server-info 的 buildTs 字段会返回它；cargo watch 重编后该值会刷新
const BUILD_TS: &str = env!("BUILD_TS");

/// 共享应用状态
struct AppState {
    config: tokio::sync::Mutex<Config>,
    config_path: std::path::PathBuf,
    logger: Logger,
    static_dir: Option<std::path::PathBuf>,
}

// ============ 工具函数 ============

fn get_local_ip() -> String {
    // 用 ipconfig 获取真实 LAN IP（IPv4 地址在同一行）
    if let Ok(output) = std::process::Command::new("ipconfig").output() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut skip_adapter = false;

        for line in stdout.lines() {
            let line = line.trim();

            // 跳过虚拟网卡段落
            if line.contains("Virtual") || line.contains("VMware") || line.contains("VirtualBox")
                || line.contains("Tailscale") || line.contains("WireGuard") || line.contains("TUN")
                || line.contains("Proxy") || line.contains("Clash") || line.contains("TAP")
            {
                skip_adapter = true;
                continue;
            }
            // 空行重置跳过标记
            if line.is_empty() {
                skip_adapter = false;
                continue;
            }
            if skip_adapter { continue; }

            // 解析 "IPv4 地址 . . . . . . . . . . . . : 192.168.1.12"
            if line.contains("IPv4") && line.contains(':') {
                if let Some(ip_str) = line.split(':').nth(1).map(|s| s.trim()) {
                    let ip_str = ip_str.trim();
                    // 只取标准局域网地址
                    if ip_str.starts_with("192.168.") || ip_str.starts_with("10.")
                        || (ip_str.starts_with("172.") && {
                            let parts: Vec<&str> = ip_str.split('.').collect();
                            parts.len() >= 2 && parts[1].parse::<u16>().map_or(false, |n| (16..=31).contains(&n))
                        })
                    {
                        return ip_str.to_string();
                    }
                }
            }
        }
    }
    // fallback: UDP 连接法
    if let Ok(udp) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if udp.connect("8.8.8.8:53").is_ok() {
            if let Ok(local) = udp.local_addr() {
                let s = local.ip().to_string();
                if !s.starts_with("198.18.") && !s.starts_with("198.19.") && !local.ip().is_loopback() {
                    return s;
                }
            }
        }
    }
    "127.0.0.1".to_string()
}

/// 主机信任门：请求是否来自运行桌面端的那台电脑（回环地址或本机局域网 IP）。
/// 客户端分类只有壳/浏览器（前端 isShell 判定）；这里是后端对「主机级操作」的安全门——
/// 只有主机（壳所在机器）能触发打开文件/文件夹/日志目录，远程设备一律拒绝。
fn is_local_client(addr: &std::net::SocketAddr) -> bool {
    if addr.ip().is_loopback() { return true; }
    addr.ip().to_string() == get_local_ip()
}

fn format_size(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1024.0 / 1024.0)
    } else if bytes >= 1024 {
        format!("{:.1} KB", bytes as f64 / 1024.0)
    } else {
        format!("{} B", bytes)
    }
}

/// 解析虚拟路径：第一段是根目录名，返回 (root_idx, 相对路径)
/// 例如 "/docs/subdir" → 根名 "docs" → (idx, "/subdir")；"/" 或空 → Err（虚拟根）
fn resolve_virtual_path(vpath: &str, roots: &[RootEntry]) -> Result<(usize, String), String> {
    let trimmed = vpath.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("虚拟根".to_string());
    }
    let mut parts = trimmed.splitn(2, '/');
    let root_name = parts.next().unwrap_or("");
    let idx = roots.iter().position(|r| r.name == root_name)
        .ok_or_else(|| format!("无效的根目录: {}", root_name))?;
    let relative = match parts.next() {
        Some(rest) if !rest.is_empty() => "/".to_string() + rest,
        _ => "/".to_string(),
    };
    Ok((idx, relative))
}

async fn save_config(state: &AppState) -> Result<(), String> {
    let config = state.config.lock().await;
    let json = serde_json::to_string_pretty(&*config).map_err(|e| e.to_string())?;
    fs::write(&state.config_path, &json).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 文件列表 ============

#[derive(Deserialize)]
struct FilesQuery {
    path: Option<String>,
}

#[derive(Serialize)]
struct FileEntry {
    name: String,
    size: u64,
    modified: String,
    #[serde(rename = "isDirectory")]
    is_directory: bool,
    extension: Option<String>,
    #[serde(rename = "fullPath")]
    full_path: String,
}

async fn handle_files(
    State(state): State<Arc<AppState>>,
    Query(query): Query<FilesQuery>,
) -> impl IntoResponse {
    let user_path = query.path.as_deref().unwrap_or("/");
    let config = state.config.lock().await;
    let roots = config.roots.clone();
    let show_hidden = config.show_hidden_files;
    drop(config);

    // 虚拟根：列出所有共享根目录
    if user_path.trim_matches('/').is_empty() {
        let entries: Vec<FileEntry> = roots.iter().map(|r| FileEntry {
            name: r.name.clone(),
            size: 0,
            modified: String::new(),
            is_directory: true,
            extension: None,
            full_path: r.path.clone(),
        }).collect();
        return (StatusCode::OK, Json(serde_json::json!({
            "success": true, "message": "", "data": {
                "currentPath": "/",
                "isDirectory": true,
                "entries": entries,
            }
        })));
    }

    let (root_idx, relative_path) = match resolve_virtual_path(user_path, &roots) {
        Ok(v) => v,
        Err(e) => {
            state.logger.warn("打开失败", Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": e})));
            return (StatusCode::OK, Json(serde_json::json!({"success": false, "message": e, "data": null})));
        }
    };
    let root_path = roots[root_idx].path.clone();
    let root_clone_for_log = root_path.clone();
    let resolved = match resolve_safe_path(&relative_path, &[root_path]) {
        Ok(p) => p,
        Err(_) => {
            state.logger.warn("打开失败", Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": "无权访问该路径"})));
            return (StatusCode::OK, Json(serde_json::json!({"success": false, "message": "无权访问该路径", "data": null})));
        }
    };

    match fs::metadata(&resolved) {
        Ok(meta) => {
            if meta.is_dir() {
                let mut entries = Vec::new();
                let dir_iter = match fs::read_dir(&resolved) {
                    Ok(d) => d,
                    Err(e) => return match e.kind() {
                        std::io::ErrorKind::PermissionDenied => {
                            state.logger.warn("打开失败", Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": "没有权限访问", "root": root_clone_for_log.clone()})));
                            (StatusCode::OK, Json(serde_json::json!({"success": false, "message": "没有权限访问", "data": null})))
                        }
                        _ => {
                            state.logger.warn("打开失败", Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": "其他原因", "root": root_clone_for_log.clone()})));
                            (StatusCode::OK, Json(serde_json::json!({"success": false, "message": "其他原因", "data": null})))
                        }
                    },
                };

                for entry in dir_iter.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !show_hidden && name.starts_with('.') {
                        continue;
                    }
                    if let Ok(entry_meta) = entry.metadata() {
                        let ext = if entry_meta.is_dir() {
                            None
                        } else {
                            Path::new(&name).extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
                        };
                        let abs_path = resolved.join(&name);
                        entries.push(FileEntry {
                            name,
                            size: entry_meta.len(),
                            full_path: abs_path.to_string_lossy().to_string(),
                            modified: entry_meta.modified()
                                .map(|t| {
                                    let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                                    let secs = duration.as_secs();
                                    if let Some(dt) = chrono::DateTime::from_timestamp(secs as i64, 0) {
                                        dt.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
                                    } else {
                                        String::new()
                                    }
                                })
                                .unwrap_or_default(),
                            is_directory: entry_meta.is_dir(),
                            extension: ext,
                        });
                    }
                }

                entries.sort_by(|a, b| {
                    if a.is_directory != b.is_directory {
                        return if a.is_directory { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
                    }
                    a.name.to_lowercase().cmp(&b.name.to_lowercase())
                });

                (StatusCode::OK, Json(serde_json::json!({
                    "success": true, "message": "", "data": {
                        "currentPath": user_path,
                        "isDirectory": true,
                        "entries": entries,
                    }
                })))
            } else {
                let entry = FileEntry {
                    name: resolved.file_name().unwrap().to_string_lossy().to_string(),
                    size: meta.len(),
                    modified: String::new(),
                    is_directory: false,
                    extension: resolved.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())),
                    full_path: resolved.to_string_lossy().to_string(),
                };
                (StatusCode::OK, Json(serde_json::json!({
                    "success": true, "message": "", "data": {
                        "currentPath": user_path,
                        "isDirectory": false,
                        "entries": [entry],
                    }
                })))
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            state.logger.warn(&format!("打开失败"), Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": "系统找不到指定的文件夹", "root": root_clone_for_log})));
            (StatusCode::OK, Json(serde_json::json!({"success": false, "message": "系统找不到指定的文件夹", "data": null})))
        }
        Err(_) => {
            state.logger.warn("打开失败", Some(10), Some(serde_json::json!({"op": 3, "dir": user_path, "error": "其他原因", "root": root_clone_for_log})));
            (StatusCode::OK, Json(serde_json::json!({"success": false, "message": "其他原因", "data": null})))
        }
    }
}

// ============ 打开文件 ============

#[derive(Deserialize)]
struct OpenFileBody {
    path: Option<String>,
}

async fn handle_file_open(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(body): Json<OpenFileBody>,
) -> impl IntoResponse {
    let user_path = match body.path {
        Some(p) => p,
        None => {
            state.logger.warn("请求参数错误", Some(6), Some(serde_json::json!({"op": 2, "file": "", "error": "请求参数错误"})));
            return err_json("请求参数错误").into_response();
        }
    };

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    drop(config);

    let (root_idx, relative_path) = match resolve_virtual_path(&user_path, &roots) {
        Ok(v) => v,
        Err(e) => {
            state.logger.warn("无效的根目录", Some(6), Some(serde_json::json!({"op": 2, "file": &user_path, "error": e})));
            return err_json("无效的根目录").into_response();
        }
    };
    let root = roots[root_idx].path.clone();

    let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
        Ok(p) => p,
        Err(_) => {
            state.logger.warn("无权访问该路径", Some(6), Some(serde_json::json!({"op": 2, "file": &user_path, "error": "无权访问该路径"})));
            return err_json("无权访问该路径").into_response();
        }
    };

    let meta = match fs::metadata(&resolved) {
        Ok(m) => m,
        Err(e) => {
            let err_msg = if e.kind() == std::io::ErrorKind::NotFound {
                "系统找不到指定的文件".to_string()
            } else {
                "其他原因".to_string()
            };
            state.logger.warn(&format!("打开失败 · {}", user_path), Some(6), Some(serde_json::json!({"op": 2, "file": user_path, "error": err_msg, "root": root.clone()})));
            return err_json(&err_msg).into_response();
        }
    };

    // 目录：用系统资源管理器打开（仅桌面端可调，避免远程设备在电脑上弹窗）
    if meta.is_dir() {
        if !is_local_client(&addr) {
            state.logger.warn(&format!("打开失败 · {}", user_path), Some(6), Some(serde_json::json!({"op": 2, "file": user_path, "error": "仅桌面端可打开文件夹", "root": root.clone()})));
            return err_json("仅桌面端可打开文件夹").into_response();
        }
        let dir_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let dir_abs = resolved.to_string_lossy().to_string();
        match std::process::Command::new("cmd")
            .args(["/c", "start", "", &dir_abs])
            .spawn()
        {
            Ok(_) => {
                state.logger.info(&dir_name, Some(6), Some(serde_json::json!({"op": 1, "file": dir_name, "dir": dir_abs, "root": root.clone()})));
                ok_json("", None).into_response()
            }
            Err(e) => {
                state.logger.error(&format!("{} — {}", dir_name, e), Some(6), Some(serde_json::json!({"op": 2, "file": dir_name, "error": "其他原因", "root": root})));
                err_json("其他原因").into_response()
            }
        };
    }

    // 文件：用系统默认程序打开（仅桌面端可调，避免远程设备在电脑上触发默认程序）
    if !is_local_client(&addr) {
        state.logger.warn(&format!("打开失败 · {}", user_path), Some(6), Some(serde_json::json!({"op": 2, "file": user_path, "error": "仅桌面端可打开文件", "root": root.clone()})));
        return err_json("仅桌面端可打开文件").into_response();
    }

    let file_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let path_abs = resolved.to_string_lossy().to_string();

    match std::process::Command::new("cmd")
        .args(["/c", "start", "", &path_abs])
        .spawn()
    {
        Ok(_) => {
            state.logger.info(&file_name, Some(6), Some(serde_json::json!({"op": 1, "file": file_name, "root": root})));
            ok_json("", None).into_response()
        }
        Err(e) => {
            state.logger.error(&format!("{} — {}", file_name, e), Some(6), Some(serde_json::json!({"op": 2, "file": file_name, "error": "其他原因", "root": root})));
            err_json("其他原因").into_response()
        }
    }
}

// ============ 根目录管理 ============

async fn handle_roots_get(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let config = state.config.lock().await;
    let roots = config.roots.clone();
    ok_json("", Some(serde_json::json!({"roots": roots}))).into_response()
}

#[derive(Deserialize)]
struct RootsPostBody {
    path: Option<String>,
    name: Option<String>,
}

async fn handle_roots_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RootsPostBody>,
) -> impl IntoResponse {
    let input_path = match body.path {
        Some(p) => p.trim().to_string(),
        None => {
            state.logger.warn("请提供目录路径", Some(7), Some(serde_json::json!({"op": 3, "dir": "", "error": "请提供目录路径"})));
            return err_json("请提供目录路径").into_response();
        }
    };

    let abs = Path::new(&input_path);
    if !abs.is_absolute() {
        let err = "请输入绝对路径，如 D:\\Share";
        state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &input_path, "error": err})));
        return err_json(err).into_response();
    }
    if !abs.exists() {
        let err = "目录不存在或无权限访问";
        state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &input_path, "error": err})));
        return err_json(err).into_response();
    }
    if !abs.is_dir() {
        let err = "路径不是目录";
        state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &input_path, "error": err})));
        return err_json(err).into_response();
    }

    let normalized = dunce::canonicalize(abs).unwrap_or_else(|_| abs.to_path_buf());
    let normalized_str = normalized.to_string_lossy().to_string();

    // 名称：未提供则取路径最后一段，必须非空且唯一
    let name = body.name.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
        .unwrap_or_else(|| Path::new(&normalized_str).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());

    let mut config = state.config.lock().await;

    if config.roots.iter().any(|r| r.path.to_lowercase() == normalized_str.to_lowercase()) {
        let err = "该目录已在共享列表中";
        state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &normalized_str, "error": err})));
        return err_json(err).into_response();
    }
    if config.roots.iter().any(|r| r.name == name) {
        let err = format!("根目录名称 \"{}\" 已存在，请换一个名称", name);
        state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &normalized_str, "error": &err})));
        return err_json(&err).into_response();
    }

    for r in &config.roots {
        let r_path = format!("{}\\", r.path.trim_end_matches('\\').trim_end_matches('/'));
        if normalized_str.starts_with(&r_path) || normalized_str.as_str() == r.path.as_str() {
            let err = format!("该目录已在 \"{}\" 的共享范围内", r.name);
            state.logger.warn("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &normalized_str, "error": &err})));
            return err_json(&err).into_response();
        }
    }

    config.roots.push(RootEntry { name: name.clone(), path: normalized_str.clone() });
    drop(config);

    if let Err(e) = save_config(&state).await {
        let err = format!("保存配置失败: {}", e);
        state.logger.error("添加失败", Some(7), Some(serde_json::json!({"op": 3, "dir": &normalized_str, "error": &err})));
        return err_json(&err).into_response();
    }

    state.logger.info(&normalized_str, Some(7), Some(serde_json::json!({"op": 1, "dir": &normalized_str, "name": name})));

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    ok_json("", Some(serde_json::json!({"roots": roots}))).into_response()
}

#[derive(Deserialize)]
struct RootsDeleteBody {
    path: Option<String>,
}

#[derive(Deserialize)]
struct RootsRenameBody {
    path: Option<String>,
    #[serde(rename = "newName")]
    new_name: Option<String>,
}

async fn handle_roots_delete(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RootsDeleteBody>,
) -> impl IntoResponse {
    let target = match body.path {
        Some(p) => p,
        None => {
            state.logger.warn("请提供要删除的目录路径", Some(7), Some(serde_json::json!({"op": 4, "dir": "", "error": "请提供要删除的目录路径"})));
            return err_json("请提供要删除的目录路径").into_response();
        }
    };

    let mut config = state.config.lock().await;
    // 路径大小写不敏感（Windows）：添加时 dunce::canonicalize 统一了大小写，
    // 移除时调用方传的路径大小写可能不一致（如 d:\ vs D:\），精确匹配会删不掉
    let target_key = target.to_lowercase();
    let idx = config.roots.iter().position(|r| r.path.to_lowercase() == target_key);
    match idx {
        Some(i) => {
            // 用 config 里已 canonicalize 的规范化路径记日志，避免前端传的路径大小写（d:\ vs D:\）不一致
            let removed = config.roots.remove(i);
            drop(config);
            if let Err(e) = save_config(&state).await {
                let err = format!("保存配置失败: {}", e);
                state.logger.error("移除失败", Some(7), Some(serde_json::json!({"op": 4, "dir": &removed.path, "error": &err})));
                return err_json(&err).into_response();
            }
            state.logger.info(&removed.path, Some(7), Some(serde_json::json!({"op": 2, "dir": removed.path.clone()})));
            let config = state.config.lock().await;
            let roots = config.roots.clone();
            ok_json("", Some(serde_json::json!({"roots": roots}))).into_response()
        }
        None => {
            state.logger.warn("移除失败", Some(7), Some(serde_json::json!({"op": 4, "dir": &target, "error": "该目录不在共享列表中"})));
            err_json("该目录不在共享列表中").into_response()
        }
    }
}

async fn handle_roots_rename(
    State(state): State<Arc<AppState>>,
    Json(body): Json<RootsRenameBody>,
) -> impl IntoResponse {
    let target = match body.path {
        Some(p) => p,
        None => {
            state.logger.warn("请提供要重命名的目录路径", Some(7), Some(serde_json::json!({"op": 7, "dir": "", "error": "请提供要重命名的目录路径"})));
            return err_json("请提供要重命名的目录路径").into_response();
        }
    };
    let new_name = match body.new_name {
        Some(n) => n.trim().to_string(),
        None => {
            state.logger.warn("请提供新名称", Some(7), Some(serde_json::json!({"op": 7, "dir": &target, "error": "请提供新名称"})));
            return err_json("请提供新名称").into_response();
        }
    };
    if new_name.is_empty() {
        state.logger.warn("重命名失败", Some(7), Some(serde_json::json!({"op": 7, "dir": &target, "error": "名称不能为空"})));
        return err_json("名称不能为空").into_response();
    }

    let mut config = state.config.lock().await;
    let path_key = target.to_lowercase();
    let idx = config.roots.iter().position(|r| r.path.to_lowercase() == path_key);
    let Some(idx) = idx else {
        state.logger.warn("重命名失败", Some(7), Some(serde_json::json!({"op": 7, "dir": &target, "error": "该目录不在共享列表中"})));
        return err_json("该目录不在共享列表中").into_response();
    };
    // 新名称唯一（排除自身）
    let name_dup = config.roots.iter().enumerate().any(|(i, r)| i != idx && r.name == new_name);
    if name_dup {
        let err = format!("根目录名称 \"{}\" 已存在，请换一个名称", new_name);
        state.logger.warn("重命名失败", Some(7), Some(serde_json::json!({"op": 7, "dir": &target, "error": &err})));
        return err_json(&err).into_response();
    }
    let old_name = config.roots[idx].name.clone();
    config.roots[idx].name = new_name.clone();
    drop(config);

    if let Err(e) = save_config(&state).await {
        let err = format!("保存配置失败: {}", e);
        state.logger.error("重命名失败", Some(7), Some(serde_json::json!({"op": 7, "dir": &target, "error": &err})));
        return err_json(&err).into_response();
    }

    state.logger.info(&format!("{} → {}", old_name, new_name), Some(7), Some(serde_json::json!({"op": 6, "dir": &target, "oldName": old_name, "newName": new_name})));

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    ok_json("", Some(serde_json::json!({"roots": roots}))).into_response()
}

// ============ 配置管理 ============

async fn handle_config_get(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let config = state.config.lock().await;
    let log_dir = state.logger.get_log_path()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
        .unwrap_or_default();
    (StatusCode::OK, Json(serde_json::json!({
        "port": config.port,
        "maxFileSizeMB": config.max_file_size_mb,
        "showHiddenFiles": config.show_hidden_files,
        "logPath": log_dir,
    })))
}

/// 打开日志目录（用系统资源管理器打开 logs/ 所在文件夹，仅桌面端可调用）
async fn handle_open_logdir(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
) -> impl IntoResponse {
    if !is_local_client(&addr) {
        state.logger.warn("打开日志目录失败", Some(6), Some(serde_json::json!({"op": 2, "file": "", "error": "仅桌面端可打开日志目录"})));
        return err_json("仅桌面端可打开日志目录").into_response();
    }
    let dir_str = state.logger.get_log_path()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
        .unwrap_or_default();
    if dir_str.is_empty() {
        state.logger.warn("打开日志目录失败", Some(6), Some(serde_json::json!({"op": 2, "file": "", "error": "日志目录不存在"})));
        return err_json("日志目录不存在").into_response();
    }
    match std::process::Command::new("cmd")
        .args(["/c", "start", "", &dir_str])
        .spawn()
    {
        Ok(_) => {
            let dir_name = std::path::Path::new(&dir_str).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "logs".to_string());
            state.logger.info(&format!("打开日志目录 · {}", dir_name), Some(6), Some(serde_json::json!({"op": 1, "file": dir_name, "dir": dir_str})));
            ok_json("", None).into_response()
        }
        Err(_) => {
            state.logger.error("打开日志目录失败", Some(6), Some(serde_json::json!({"op": 2, "file": "", "error": "打开日志目录失败"})));
            err_json("打开日志目录失败").into_response()
        }
    }
}

#[derive(Deserialize)]
struct ConfigPutBody {
    #[serde(rename = "maxFileSizeMB")]
    max_file_size_mb: Option<f64>,
    #[serde(rename = "showHiddenFiles")]
    show_hidden_files: Option<bool>,
}

async fn handle_config_put(
    State(state): State<Arc<AppState>>,
    Json(body): Json<ConfigPutBody>,
) -> impl IntoResponse {
    let (old_size, old_hidden) = {
        let c = state.config.lock().await;
        (c.max_file_size_mb, c.show_hidden_files)
    };

    if let Some(m) = body.max_file_size_mb {
        if m < 1.0 || m > 9999.0 {
            state.logger.warn("保存配置失败", Some(8), Some(serde_json::json!({"op": 2, "field": "maxFileSizeMB", "error": "文件大小上限必须在 1-9999 MB 之间"})));
            return err_json("文件大小上限必须在 1-9999 MB 之间").into_response();
        }
        if m as u64 != old_size {
            let mut config = state.config.lock().await;
            config.max_file_size_mb = m as u64;
            drop(config);
            if let Err(e) = save_config(&state).await {
                let err = format!("保存配置失败: {}", e);
                state.logger.error("保存配置失败", Some(8), Some(serde_json::json!({"op": 2, "field": "maxFileSizeMB", "error": &err})));
                return err_json(&err).into_response();
            }
            state.logger.info("最大上传 (MB)修改", Some(8), Some(serde_json::json!({"op": 1, "field": "maxFileSizeMB", "ori": old_size, "now": m as u64})));
        }
    }
    if let Some(h) = body.show_hidden_files {
        if h != old_hidden {
            let mut config = state.config.lock().await;
            config.show_hidden_files = h;
            drop(config);
            if let Err(e) = save_config(&state).await {
                let err = format!("保存配置失败: {}", e);
                state.logger.error("保存配置失败", Some(8), Some(serde_json::json!({"op": 2, "field": "showHiddenFiles", "error": &err})));
                return err_json(&err).into_response();
            }
            state.logger.info(if h { "开启隐藏文件" } else { "关闭隐藏文件" }, Some(8), Some(serde_json::json!({"op": 1, "field": "showHiddenFiles", "ori": old_hidden, "now": h})));
        }
    }
    ok_json("配置已更新", None).into_response()
}

// ============ 文件上传 ============

#[derive(Deserialize)]
struct UploadCheckBody {
    #[serde(rename = "targetPath")]
    target_path: Option<String>,
    names: Option<Vec<String>>,
}

async fn handle_upload_check(
    State(state): State<Arc<AppState>>,
    Json(body): Json<UploadCheckBody>,
) -> impl IntoResponse {
    let user_path = body.target_path.as_deref().unwrap_or("/");

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    drop(config);
    let (root_idx, relative_path) = match resolve_virtual_path(user_path, &roots) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))),
    };
    let root = roots[root_idx].path.clone();

    let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
        Ok(p) => p,
        Err(e) => return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": e}))),
    };

    let names = body.names.unwrap_or_default();
    let mut conflicts = Vec::new();
    for name in &names {
        if resolved.join(name).exists() {
            conflicts.push(name.clone());
        }
    }

    (StatusCode::OK, Json(serde_json::json!({"conflicts": conflicts})))
}

async fn handle_upload(
    State(state): State<Arc<AppState>>,
    req: Request<axum::body::Body>,
) -> impl IntoResponse {
    // 先读配置，用 max_file_size_mb 决定 multer 硬上限（此前写死 50MB/100MB，会静默截断 >50MB 的文件并写入空文件）
    let config = state.config.lock().await;
    let roots = config.roots.clone();
    let max_size = config.max_file_size_mb * 1024 * 1024;
    drop(config);

    let content_type = req.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v: &axum::http::HeaderValue| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let boundary = match multer::parse_boundary(&content_type) {
        Ok(b) => b.to_string(),
        Err(_) => {
            state.logger.error("上传失败", Some(1), Some(serde_json::json!({"op": 2, "file": "", "error": "Invalid Content-Type"})));
            return err_json("Invalid Content-Type").into_response();
        }
    };

    // 单文件上限 = 配置值 + 1MB 余量（恰好超限的文件由下方 size 检查返回明确错误）；
    // 整流上限 ×20 留出多文件批次空间，避免 multer 在配置允许范围内提前截断
    let constraints = multer::Constraints::new()
        .size_limit(multer::SizeLimit::new()
            .whole_stream(max_size.saturating_mul(20).max(50 * 1024 * 1024))
            .per_field(max_size.saturating_add(1024 * 1024)));

    let body_stream = BodyDataStream::new(req.into_body());
    let mut multipart = multer::Multipart::with_constraints(
        body_stream,
        boundary,
        constraints,
    );
    let mut target_path = String::from("/");
    let mut replace_list: Vec<String> = Vec::new();
    let mut file_fields: Vec<(String, Vec<u8>)> = Vec::new();

    while let Ok(Some(field)) = multipart.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "targetPath" => {
                target_path = field.text().await.unwrap_or_else(|_| "/".to_string());
            }
            "replace" => {
                let text = field.text().await.unwrap_or_default();
                replace_list = text.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
            }
            _ => {
                let file_name = field.file_name().map(|s| s.to_string()).unwrap_or_default();
                if !file_name.is_empty() {
                    // 文件超过配置上限时 multer 在此报错：明确提示，绝不写入空文件
                    let data = match field.bytes().await {
                        Ok(d) => d.to_vec(),
                        Err(_) => {
                            let root_str = resolve_virtual_path(&target_path, &roots)
                                .ok()
                                .map(|(idx, _)| roots[idx].path.clone())
                                .unwrap_or_default();
                            let msg = format!("文件过大，最大允许 {} MB", max_size / 1024 / 1024);
                            state.logger.warn(&format!("上传失败 · {}", file_name), Some(1), Some(serde_json::json!({"op": 2, "file": file_name, "error": msg, "root": root_str})));
                            return err_json(&msg).into_response();
                        }
                    };
                    file_fields.push((file_name, data));
                }
            }
        }
    }

    if file_fields.is_empty() {
        state.logger.warn("没有选择文件", Some(1), Some(serde_json::json!({"op": 2, "file": "", "error": "没有选择文件"})));
        return err_json("没有选择文件").into_response();
    }

    if roots.is_empty() {
        state.logger.warn("请先添加共享目录", Some(1), Some(serde_json::json!({"op": 2, "file": "", "error": "请先添加共享目录"})));
        return err_json("请先添加共享目录").into_response();
    }

    let (root_idx, relative_path) = match resolve_virtual_path(&target_path, &roots) {
        Ok(v) => v,
        Err(_) => {
            state.logger.warn("无效的根目录", Some(1), Some(serde_json::json!({"op": 2, "file": "", "error": "无效的根目录"})));
            return err_json("无效的根目录").into_response();
        }
    };
    let root = roots[root_idx].path.clone();

    let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
        Ok(p) => p,
        Err(_) => {
            state.logger.warn("无权访问该路径", Some(1), Some(serde_json::json!({"op": 2, "file": "", "error": "无权访问该路径"})));
            return err_json("无权访问该路径").into_response();
        }
    };

    let _ = fs::create_dir_all(&resolved);
    let mut uploaded = 0u32;
    let mut replaced = 0u32;
    let mut new_count = 0u32;
    let mut kept_count = 0u32;
    let mut results: Vec<serde_json::Value> = Vec::new();

    for (original_name, data) in &file_fields {
        if data.len() as u64 > max_size {
            state.logger.warn(&format!("上传失败 · {}", original_name), Some(1), Some(serde_json::json!({"op": 2, "file": original_name, "error": format!("文件过大，最大允许 {} MB", max_size / 1024 / 1024), "root": root})));
            return err_json(&format!("文件过大，最大允许 {} MB", max_size / 1024 / 1024)).into_response();
        }

        let file_size = data.len() as u64;
        let mut final_name = original_name.clone();
        let file_path = resolved.join(&final_name);

        // 替换时先删旧文件
        if replace_list.contains(original_name) && file_path.exists() {
            let _ = fs::remove_file(&file_path);
        } else {
            let mut counter = 1u32;
            while file_path.exists() {
                let stem = std::path::Path::new(original_name)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| original_name.clone());
                let ext_str = std::path::Path::new(original_name)
                    .extension()
                    .map(|e| format!(".{}", e.to_string_lossy()))
                    .unwrap_or_default();
                final_name = format!("{} ({}){}", stem, counter, ext_str);
                let new_path = resolved.join(&final_name);
                if !new_path.exists() {
                    break;
                }
                counter += 1;
            }
        }

        match fs::write(resolved.join(&final_name), data) {
            Ok(()) => {
                let action = if replace_list.contains(original_name) && file_path.exists() { "replaced" } else if final_name != *original_name { "kept" } else { "new" };
                if action == "replaced" { replaced += 1; } else { uploaded += 1; }
                if action == "new" { new_count += 1; } else if action == "kept" { kept_count += 1; }
                results.push(serde_json::json!({"name": final_name, "originalName": original_name, "size": file_size, "action": action}));
            }
            Err(_) => {
                // 替换失败记 type=2 op=2（与上传失败的 type=1 op=2 区分），前端渲染「替换失败」
                if replace_list.contains(original_name) {
                    state.logger.error(&format!("替换失败 · {}", original_name), Some(2), Some(serde_json::json!({"op": 2, "file": original_name, "error": "其他原因", "root": root})));
                } else {
                    state.logger.error(&format!("上传失败 · {}", original_name), Some(1), Some(serde_json::json!({"op": 2, "file": original_name, "error": "其他原因", "root": root})));
                }
                results.push(serde_json::json!({"name": final_name, "originalName": original_name, "size": file_size, "action": "write_failed"}));
            }
        }
    }

    let target_dir_str = resolved.to_string_lossy().to_string();

    if uploaded > 0 {
        let log_files: Vec<serde_json::Value> = results.iter().filter(|f| f.get("action").and_then(|a| a.as_str()) == Some("new") || f.get("action").and_then(|a| a.as_str()) == Some("kept")).map(|f| {
            serde_json::json!({"name": f["name"], "size": format_size(f["size"].as_u64().unwrap_or(0))})
        }).collect();
        state.logger.info(&format!("{} 个 → {}", uploaded, target_dir_str), Some(1), Some(serde_json::json!({"op": 1, "dir": target_dir_str, "count": uploaded, "files": log_files, "root": root})));
    }
    if replaced > 0 {
        let rep_files: Vec<serde_json::Value> = results.iter().filter(|f| f.get("action").and_then(|a| a.as_str()) == Some("replaced")).map(|f| {
            serde_json::json!({"name": f["name"], "size": format_size(f["size"].as_u64().unwrap_or(0))})
        }).collect();
        state.logger.info(&format!("{} 个 → {}", replaced, target_dir_str), Some(2), Some(serde_json::json!({"op": 1, "dir": target_dir_str, "count": replaced, "files": rep_files, "root": root})));
    }

    let mut parts = Vec::new();
    if new_count > 0 { parts.push(format!("新增({}个文件)", new_count)); }
    if kept_count > 0 { parts.push(format!("保留({}个文件)", kept_count)); }
    if replaced > 0 { parts.push(format!("替换({}个文件)", replaced)); }

    ok_json(&parts.join("，"), Some(serde_json::json!({"files": results}))).into_response()
}

// ============ 文件下载 ============

#[derive(Deserialize)]
struct DownloadQuery {
    path: Option<String>,
    /// inline=1/true 时 Content-Disposition 用 inline（预览用），默认 attachment（下载）
    inline: Option<String>,
}

/// 错误响应：统一格式 { success: false, message, data: null }
fn err_json(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(serde_json::json!({"success": false, "message": msg, "data": null})))
}

/// 成功响应：统一格式 { success: true, message, data }
fn ok_json(msg: &str, data: Option<serde_json::Value>) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::OK, Json(serde_json::json!({"success": true, "message": msg, "data": data})))
}

/// 解析 HTTP Range 头（仅支持单段 bytes 区间）
/// None → 无 Range 头（整文件）；Bytes(start, end) → 含端点的满足区间；Unsatisfiable → 无法满足（416）
enum RangeResult {
    None,
    Bytes(u64, u64),
    Unsatisfiable,
}

fn parse_range(header: Option<&str>, size: u64) -> RangeResult {
    let h = match header {
        Some(h) => h,
        None => return RangeResult::None,
    };
    let spec = h.strip_prefix("bytes=").unwrap_or(h).trim();
    // 多段 Range 不支持 → 416
    if spec.contains(',') { return RangeResult::Unsatisfiable; }
    let (start_s, end_s) = match spec.split_once('-') {
        Some(p) => p,
        None => return RangeResult::Unsatisfiable,
    };
    let start_s = start_s.trim();
    let end_s = end_s.trim();

    // 后缀形式 bytes=-N：最后 N 字节
    if start_s.is_empty() {
        if size == 0 { return RangeResult::Unsatisfiable; }
        let n: u64 = match end_s.parse() {
            Ok(n) if n > 0 => n,
            _ => return RangeResult::Unsatisfiable,
        };
        let start = size.saturating_sub(n);
        return RangeResult::Bytes(start, size - 1);
    }

    let start: u64 = match start_s.parse() {
        Ok(s) => s,
        Err(_) => return RangeResult::Unsatisfiable,
    };
    if start >= size { return RangeResult::Unsatisfiable; }
    let end = if end_s.is_empty() {
        size - 1
    } else {
        match end_s.parse::<u64>() {
            Ok(e) => e.min(size - 1),
            Err(_) => return RangeResult::Unsatisfiable,
        }
    };
    if end < start { return RangeResult::Unsatisfiable; }
    RangeResult::Bytes(start, end)
}

/// 是否「初始请求」：无 Range 或 Range 从 0 开始（浏览器播放视频的首次请求形态）。
/// 只有初始请求写日志，拖进度条等 seek 请求不写，避免日志被播放刷屏。
fn is_initial_request(range: &RangeResult) -> bool {
    match range {
        RangeResult::None => true,
        RangeResult::Bytes(0, _) => true,
        _ => false,
    }
}

async fn handle_download(
    State(state): State<Arc<AppState>>,
    headers: axum::http::HeaderMap,
    Query(query): Query<DownloadQuery>,
) -> impl IntoResponse {
    let user_path = match query.path {
        Some(p) => p,
        None => {
            state.logger.warn("请求参数错误", Some(5), Some(serde_json::json!({"op": 2, "file": "", "error": "请求参数错误"})));
            return err_json("请求参数错误").into_response();
        }
    };

    // inline=1/true → 预览（Content-Disposition: inline + 日志 type=13 预览）；否则下载（type=5）
    let inline = match query.inline.as_deref() {
        Some(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        None => false,
    };
    let log_type: u32 = if inline { 13 } else { 5 };

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    drop(config);
    let (root_idx, relative_path) = match resolve_virtual_path(&user_path, &roots) {
        Ok(v) => v,
        Err(e) => {
            state.logger.warn("无效的根目录", Some(log_type), Some(serde_json::json!({"op": 2, "file": &user_path, "error": e})));
            return err_json("无效的根目录").into_response();
        }
    };
    let root = roots[root_idx].path.clone();

    let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
        Ok(p) => p,
        Err(_) => {
            state.logger.warn("无权访问该路径", Some(log_type), Some(serde_json::json!({"op": 2, "file": &user_path, "error": "无权访问该路径"})));
            return err_json("无权访问该路径").into_response();
        }
    };

    let meta = match fs::metadata(&resolved) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            state.logger.warn(&format!("下载失败 · {}", user_path), Some(log_type), Some(serde_json::json!({"op": 2, "file": user_path, "error": "系统找不到指定的文件"})));
            return err_json("系统找不到指定的文件").into_response();
        }
        Err(e) => {
            state.logger.error(&format!("下载失败 · {}", user_path), Some(log_type), Some(serde_json::json!({"op": 2, "file": user_path, "error": e.to_string()})));
            return err_json("其他原因").into_response();
        }
    };

    if meta.is_dir() {
        state.logger.warn(&format!("下载失败 · {}", user_path), Some(log_type), Some(serde_json::json!({"op": 2, "file": user_path, "error": "不能下载目录", "is_dir": true})));
        return err_json("不能下载目录").into_response();
    }

    let file_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let file_size = meta.len();
    let ext = resolved.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let content_type = MIME_TYPES.get(ext.as_str()).unwrap_or(&"application/octet-stream");
    let encoded_name = urlencoding::encode(&file_name);
    let disposition = if inline { "inline" } else { "attachment" };

    let range = parse_range(headers.get(header::RANGE).and_then(|v| v.to_str().ok()), file_size);

    // 仅初始请求写日志：预览/下载成功
    if is_initial_request(&range) {
        state.logger.info(&file_name, Some(log_type), Some(serde_json::json!({"op": 1, "file": user_path, "size": format_size(file_size), "root": root})));
    }

    // 流式发送：ReaderStream 边读边发，避免大文件一次性读入内存（此前 tokio::fs::read 会把 ~1GB 文件整块载入）
    match tokio::fs::File::open(&resolved).await {
        Ok(file) => match range {
            RangeResult::Bytes(start, end) => {
                // 部分内容 206：seek 到 start 后 take(len) 限长，Range 请求支撑视频拖动进度
                let mut file = file;
                if file.seek(SeekFrom::Start(start)).await.is_err() {
                    state.logger.error(&format!("下载失败 · {}", user_path), Some(log_type), Some(serde_json::json!({"op": 2, "file": user_path, "error": "其他原因", "root": root})));
                    return err_json("其他原因").into_response();
                }
                let len = end - start + 1;
                let limited = file.take(len);
                let stream = ReaderStream::new(limited);
                let body = axum::body::Body::from_stream(stream);
                (StatusCode::PARTIAL_CONTENT, [
                    (header::CONTENT_DISPOSITION, format!("{}; filename*=UTF-8''{}", disposition, encoded_name).as_str()),
                    (header::CONTENT_TYPE, *content_type),
                    (header::CONTENT_LENGTH, &len.to_string()),
                    (header::CONTENT_RANGE, &format!("bytes {}-{}/{}", start, end, file_size)),
                    (header::ACCEPT_RANGES, "bytes"),
                ], body).into_response()
            }
            RangeResult::Unsatisfiable => {
                // 416：无法满足的 Range
                (StatusCode::RANGE_NOT_SATISFIABLE, [
                    (header::CONTENT_RANGE, format!("bytes */{}", file_size).as_str()),
                    (header::ACCEPT_RANGES, "bytes"),
                ], axum::body::Body::empty()).into_response()
            }
            RangeResult::None => {
                // 整文件 200
                let stream = ReaderStream::new(file);
                let body = axum::body::Body::from_stream(stream);
                (StatusCode::OK, [
                    (header::CONTENT_DISPOSITION, format!("{}; filename*=UTF-8''{}", disposition, encoded_name).as_str()),
                    (header::CONTENT_TYPE, *content_type),
                    (header::CONTENT_LENGTH, &file_size.to_string()),
                    (header::ACCEPT_RANGES, "bytes"),
                ], body).into_response()
            }
        },
        Err(_) => {
            state.logger.error(&format!("下载失败 · {}", user_path), Some(log_type), Some(serde_json::json!({"op": 2, "file": user_path, "error": "其他原因", "root": root})));
            err_json("其他原因").into_response()
        }
    }
}

/// 判断解析后的路径是否为某个共享根目录本身（用于禁止删除根目录）
fn is_root_path(resolved: &std::path::Path, root: &str) -> bool {
    let a = resolved.to_string_lossy();
    let a = a.trim_end_matches('/').trim_end_matches('\\');
    let b = root.trim_end_matches('/').trim_end_matches('\\');
    a == b
}

// ============ 文件删除（回收站优先） ============

#[derive(Deserialize)]
struct DeleteQuery {
    path: Option<String>,
}

async fn handle_delete(
    State(state): State<Arc<AppState>>,
    Query(query): Query<DeleteQuery>,
) -> impl IntoResponse {
    let user_path = match query.path {
        Some(p) => p,
        None => {
            state.logger.warn("请求参数错误", Some(4), Some(serde_json::json!({"op": 3, "file": "", "error": "请求参数错误"})));
            return err_json("请求参数错误").into_response();
        }
    };

    let config = state.config.lock().await;
    if config.roots.is_empty() {
        state.logger.warn("请先添加共享目录", Some(4), Some(serde_json::json!({"op": 3, "file": &user_path, "error": "请先添加共享目录"})));
        return err_json("请先添加共享目录").into_response();
    }
    let roots = config.roots.clone();
    drop(config);
    let (root_idx, relative_path) = match resolve_virtual_path(&user_path, &roots) {
        Ok(v) => v,
        Err(e) => {
            state.logger.warn("无效的根目录", Some(4), Some(serde_json::json!({"op": 3, "file": &user_path, "error": e})));
            return err_json("无效的根目录").into_response();
        }
    };
    let root = roots[root_idx].path.clone();

    let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
        Ok(p) => p,
        Err(_) => {
            state.logger.warn("无权访问该路径", Some(4), Some(serde_json::json!({"op": 3, "file": &user_path, "error": "无权访问该路径"})));
            return err_json("无权访问该路径").into_response();
        }
    };

    // 防御：禁止删除共享根目录本身（虚拟路径只到根名 → 应从共享列表移除）
    if is_root_path(&resolved, &root) {
        state.logger.warn("不能在根目录删除", Some(4), Some(serde_json::json!({"op": 3, "file": &user_path, "error": "不能在根目录删除，请用移除", "root": root})));
        return err_json("不能在根目录删除，请用移除").into_response();
    }

    let is_dir = match fs::metadata(&resolved) {
        Ok(m) => m.is_dir(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            state.logger.warn(&format!("删除失败 · {}", user_path), Some(4), Some(serde_json::json!({"op": 3, "file": user_path, "error": "系统找不到指定的文件", "root": root})));
            return err_json("系统找不到指定的文件").into_response();
        }
        Err(_) => {
            state.logger.error(&format!("删除失败 · {}", user_path), Some(4), Some(serde_json::json!({"op": 3, "file": user_path, "error": "其他原因", "root": root})));
            return err_json("其他原因").into_response();
        }
    };

    let parent_dir = resolved.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let file_name = resolved.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();

    // 尝试回收站
    if let Ok(()) = move_to_trash(&resolved, is_dir) {
        state.logger.info(&format!("1 个 → {}", parent_dir), Some(4), Some(serde_json::json!({"op": 1, "count": 1, "dir": parent_dir, "files": [{"name": file_name}], "dest": "trash", "root": root})));
        return ok_json("已移入回收站", Some(serde_json::json!({"dest": "trash"}))).into_response();
    }

    // 回收站失败 → 永久删除
    state.logger.warn(&format!("1 个 → {}", parent_dir), Some(4), Some(serde_json::json!({"op": 2, "count": 1, "dir": parent_dir, "files": [{"name": file_name}], "dest": "permanent", "root": root})));
    let rm_result = if is_dir {
        tokio::fs::remove_dir_all(&resolved).await
    } else {
        tokio::fs::remove_file(&resolved).await
    };
    match rm_result {
        Ok(()) => {
            state.logger.info(&file_name, Some(4), Some(serde_json::json!({"op": 2, "count": 1, "dir": parent_dir, "files": [{"name": file_name}], "dest": "permanent", "root": root})));
            ok_json("已永久删除（回收站不可用）", Some(serde_json::json!({"dest": "permanent"}))).into_response()
        }
        Err(_) => {
            state.logger.error(&format!("删除失败 · {}", user_path), Some(4), Some(serde_json::json!({"op": 3, "file": user_path, "error": "其他原因", "root": root})));
            err_json("其他原因").into_response()
        }
    }
}

// ============ 批量删除 ============

#[derive(Deserialize)]
struct BatchDeleteBody {
    paths: Option<Vec<String>>,
}

#[derive(Serialize)]
struct BatchDeleteResult {
    path: String,
    success: bool,
    dest: Option<String>,
    message: Option<String>,
}

async fn handle_delete_batch(
    State(state): State<Arc<AppState>>,
    Json(body): Json<BatchDeleteBody>,
) -> impl IntoResponse {
    let paths = match body.paths {
        Some(p) if !p.is_empty() => p,
        _ => {
            state.logger.warn("删除失败", Some(4), Some(serde_json::json!({"op": 3, "file": "", "error": "请提供要删除的文件路径列表"})));
            return err_json("请提供要删除的文件路径列表").into_response();
        }
    };

    let config = state.config.lock().await;
    let roots = config.roots.clone();
    drop(config);

    let mut success_count = 0u32;
    let mut fail_count = 0u32;
    let mut success_files: Vec<serde_json::Value> = Vec::new();
    let mut results: Vec<BatchDeleteResult> = Vec::new();

    for path_str in &paths {
        let (root_idx, relative_path) = match resolve_virtual_path(path_str, &roots) {
            Ok(v) => v,
            Err(e) => {
                fail_count += 1;
                state.logger.warn(&format!("删除失败 · {}", path_str), Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": e})));
                results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some(e) });
                continue;
            }
        };
        let root = roots[root_idx].path.clone();
        let resolved = match resolve_safe_path(&relative_path, &[root.clone()]) {
            Ok(p) => p,
            Err(_) => {
                fail_count += 1;
                state.logger.warn(&format!("删除失败 · {}", path_str), Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": "无权访问该路径", "root": &root})));
                results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some("无权访问该路径".to_string()) });
                continue;
            }
        };

        // 防御：禁止删除共享根目录本身（应从共享列表移除）
        if is_root_path(&resolved, &root) {
            fail_count += 1;
            state.logger.warn("不能在根目录删除", Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": "不能在根目录删除，请用移除", "root": &root})));
            results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some("不能在根目录删除，请用移除".to_string()) });
            continue;
        }

        let is_dir = match fs::metadata(&resolved) {
            Ok(m) => m.is_dir(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fail_count += 1;
                state.logger.warn(&format!("删除失败 · {}", path_str), Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": "系统找不到指定的文件", "root": &root})));
                results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some("系统找不到指定的文件".to_string()) });
                continue;
            }
            Err(_) => {
                fail_count += 1;
                state.logger.warn(&format!("删除失败 · {}", path_str), Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": "其他原因", "root": &root})));
                results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some("其他原因".to_string()) });
                continue;
            }
        };

        if let Ok(()) = move_to_trash(&resolved, is_dir) {
            success_count += 1;
            let log_path = if is_dir { format!("{}/", path_str) } else { path_str.clone() };
            success_files.push(serde_json::json!({"name": log_path}));
            results.push(BatchDeleteResult { path: path_str.clone(), success: true, dest: Some("trash".to_string()), message: None });
        } else {
            let rm_result = if is_dir {
                tokio::fs::remove_dir_all(&resolved).await
            } else {
                tokio::fs::remove_file(&resolved).await
            };
            match rm_result {
                Ok(()) => {
                    success_count += 1;
                    let log_path = if is_dir { format!("{}/", path_str) } else { path_str.clone() };
                    success_files.push(serde_json::json!({"name": log_path}));
                    results.push(BatchDeleteResult { path: path_str.clone(), success: true, dest: Some("permanent".to_string()), message: None });
                }
                Err(_) => {
                    fail_count += 1;
                    state.logger.error(&format!("删除失败 · {}", path_str), Some(4), Some(serde_json::json!({"op": 3, "file": path_str, "error": "其他原因", "root": &root})));
                    results.push(BatchDeleteResult { path: path_str.clone(), success: false, dest: None, message: Some("其他原因".to_string()) });
                }
            }
        }
    }

    // 日志：成功聚合，失败单点
    if success_count > 0 {
        let dest = if results.iter().any(|r| r.dest.as_deref() == Some("permanent")) { "permanent" } else { "trash" };
        state.logger.info(&format!("批量删除"), Some(4), Some(serde_json::json!({"op": if dest == "trash" { 1 } else { 2 }, "count": success_count, "files": success_files, "dest": dest})));
    }

    let message = if fail_count == 0 {
        if success_count > 1 {
            format!("已删除 {} 项", success_count)
        } else {
            "已删除".to_string()
        }
    } else {
        format!("已删除 {} 项，{} 项失败", success_count, fail_count)
    };

    ok_json(&message, Some(serde_json::json!({
        "total": paths.len(),
        "successCount": success_count,
        "failCount": fail_count,
        "results": results,
    }))).into_response()
}

fn move_to_trash(abs_path: &Path, is_dir: bool) -> Result<(), String> {
    let method = if is_dir { "DeleteDirectory" } else { "DeleteFile" };
    let path_str = abs_path.to_string_lossy().replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::{}('{}','OnlyErrorDialogs','SendToRecycleBin')",
        method, path_str
    );
    let encoded = base64_encode_utf16le(&script);
    let output = std::process::Command::new("powershell")
        .args(["-EncodedCommand", &encoded])
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn base64_encode_utf16le(input: &str) -> String {
    let utf16: Vec<u16> = input.encode_utf16().collect();
    let mut bytes = Vec::with_capacity(utf16.len() * 2);
    for &c in &utf16 {
        bytes.push((c & 0xFF) as u8);
        bytes.push((c >> 8) as u8);
    }
    base64_encode(&bytes)
}

fn base64_encode(input: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);
        result.push(if chunk.len() > 1 { CHARS[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
        result.push(if chunk.len() > 2 { CHARS[(triple & 0x3F) as usize] as char } else { '=' });
    }
    result
}

// ============ MIME 映射 ============

const MIME_TYPES: phf::Map<&'static str, &'static str> = phf::phf_map! {
    "txt" => "text/plain; charset=utf-8",
    "html" => "text/html; charset=utf-8",
    "css" => "text/css; charset=utf-8",
    "js" => "application/javascript; charset=utf-8",
    "json" => "application/json; charset=utf-8",
    "md" => "text/markdown; charset=utf-8",
    "markdown" => "text/markdown; charset=utf-8",
    "png" => "image/png",
    "jpg" => "image/jpeg",
    "jpeg" => "image/jpeg",
    "gif" => "image/gif",
    "svg" => "image/svg+xml",
    "webp" => "image/webp",
    "ico" => "image/x-icon",
    "bmp" => "image/bmp",
    "pdf" => "application/pdf",
    "doc" => "application/msword",
    "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls" => "application/vnd.ms-excel",
    "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt" => "application/vnd.ms-powerpoint",
    "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "zip" => "application/zip",
    "rar" => "application/vnd.rar",
    "7z" => "application/x-7z-compressed",
    "tar" => "application/x-tar",
    "gz" => "application/gzip",
    "mp3" => "audio/mpeg",
    "mp4" => "video/mp4",
    "webm" => "video/webm",
    "m4v" => "video/x-m4v",
    "ogv" => "video/ogg",
    "mpeg" => "video/mpeg",
    "mpg" => "video/mpeg",
    "flv" => "video/x-flv",
    "avi" => "video/x-msvideo",
    "mkv" => "video/x-matroska",
    "mov" => "video/quicktime",
    "wav" => "audio/wav",
    "flac" => "audio/flac",
    "apk" => "application/vnd.android.package-archive",
    "ipa" => "application/octet-stream",
};

// ============ 服务信息 ============

#[derive(Serialize)]
struct ServerInfo {
    ip: String,
    port: u16,
    url: String,
    /// 编译时间戳（build.rs 注入），用于判断后端是否最新编译
    #[serde(rename = "buildTs")]
    build_ts: String,
}

async fn handle_server_info(
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    let port = state.config.lock().await.port;
    let ip = get_local_ip();
    (StatusCode::OK, Json(ServerInfo {
        ip: ip.clone(),
        port,
        url: format!("http://{}:{}", ip, port),
        build_ts: BUILD_TS.to_string(),
    }))
}

// ============ 日志 ============

#[derive(Deserialize)]
struct LogsQuery {
    lines: Option<usize>,
    level: Option<String>,
    search: Option<String>,
}

async fn handle_logs_get(
    State(state): State<Arc<AppState>>,
    Query(query): Query<LogsQuery>,
) -> impl IntoResponse {
    let lines = query.lines.unwrap_or(200).min(5000);
    let options = LogQuery {
        level: query.level,
        search: query.search,
    };
    let entries = state.logger.get_buffer(lines, &options);
    (StatusCode::OK, Json(entries))
}

async fn handle_logs_delete(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.logger.clear_buffer() {
        Ok(()) => {
            state.logger.info("日志已清空", Some(11), Some(serde_json::json!({"op": 1})));
            (StatusCode::OK, Json(serde_json::json!({"success": true})))
        }
        Err(e) => {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e})))
        }
    }
}

async fn handle_logs_display_clear(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    state.logger.clear_ring_buffer();
    state.logger.info("显示已清空", Some(11), Some(serde_json::json!({"op": 2})));
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

#[derive(Deserialize)]
struct LogPostBody {
    level: Option<String>,
    message: Option<String>,
    r#type: Option<u32>,
    data: Option<serde_json::Value>,
}

async fn handle_logs_post(
    State(state): State<Arc<AppState>>,
    Json(body): Json<LogPostBody>,
) -> impl IntoResponse {
    let msg = body.message.unwrap_or_default();
    let level = body.level.as_deref().unwrap_or("info").to_lowercase();
    match level.as_str() {
        "warn" => state.logger.warn(&msg, body.r#type, body.data),
        "error" => state.logger.error(&msg, body.r#type, body.data),
        _ => state.logger.info(&msg, body.r#type, body.data),
    }
    (StatusCode::OK, Json(serde_json::json!({"success": true})))
}

async fn handle_logs_stream(
    State(state): State<Arc<AppState>>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.logger.sse_receiver();
    let stream = BroadcastStream::new(rx).filter_map(|result| {
        match result {
            Ok(entry) => {
                if let Ok(json) = serde_json::to_string(&entry) {
                    Some(Ok::<_, Infallible>(Event::default().data(json)))
                } else {
                    None
                }
            }
            Err(_) => None,
        }
    });

    Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text(": heartbeat"))
}

// ============ SPA Fallback ============

async fn handle_fallback(
    State(state): State<Arc<AppState>>,
    req: axum::extract::Request,
) -> axum::response::Response {
    let path = req.uri().path().to_string();

    if path.starts_with("/api/") {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "API endpoint not found"}))).into_response();
    }

    if let Some(ref static_dir) = state.static_dir {
        let file_path = static_dir.join(path.strip_prefix('/').unwrap_or(""));
        if file_path.exists() && file_path.is_file() {
            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
            let content_type = match ext.as_str() {
                "html" => "text/html; charset=utf-8",
                "css" => "text/css; charset=utf-8",
                "js" => "application/javascript; charset=utf-8",
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "svg" => "image/svg+xml",
                "ico" => "image/x-icon",
                "json" => "application/json",
                _ => "application/octet-stream",
            };
            let cache_control = if ext == "html" || ext == "js" || ext == "css" {
                "no-cache, no-store, must-revalidate"
            } else {
                "public, max-age=3600"
            };

            if let Ok(data) = fs::read(&file_path) {
                return (StatusCode::OK, [(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, cache_control)], data).into_response();
            }
        }

        let index_path = static_dir.join("index.html");
        if index_path.exists() {
            if let Ok(data) = fs::read(&index_path) {
                return (StatusCode::OK, [
                    (header::CONTENT_TYPE, "text/html; charset=utf-8"),
                    (header::CACHE_CONTROL, "no-cache, no-store, must-revalidate"),
                ], data).into_response();
            }
        }
    }

    (StatusCode::OK, "LanDisk API is running.").into_response()
}

// ============ 主函数 ============

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mut static_dir: Option<std::path::PathBuf> = None;
    for arg in &args {
        if let Some(dir) = arg.strip_prefix("--static-dir=") {
            let p = std::path::PathBuf::from(dir);
            if p.exists() {
                static_dir = Some(p);
            }
        }
    }

    // 数据目录 = 可执行文件所在目录（安装目录），方便用户直接编辑 config.json
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let user_data_dir = std::env::var("LANDISK_DATA_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or(exe_dir);
    // 统一为绝对路径：LANDISK_DATA_DIR 传相对值（如 dev-data）时，日志/配置「位置」会显示相对路径，统一成绝对
    let user_data_dir = if user_data_dir.is_absolute() {
        user_data_dir
    } else {
        std::env::current_dir().map(|c| c.join(&user_data_dir)).unwrap_or(user_data_dir)
    };

    let (config, config_path) = config::load_config(&user_data_dir);
    let logger = Logger::new();
    logger.init(&user_data_dir);
    let log_path = logger.get_log_path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();

    let port = config.port;
    // 上传 body 硬上限：配置单文件上限 ×20 留出多文件批次余量（运行期改配置后 multer 内的上限才是权威闸门）
    let upload_limit = (config.max_file_size_mb * 20 * 1024 * 1024) as usize;
    let roots: Vec<String> = config.roots.iter().map(|r| r.path.clone()).collect();

    let app_state = Arc::new(AppState {
        config: tokio::sync::Mutex::new(config),
        config_path: config_path.clone(),
        logger,
        static_dir,
    });

    app_state.logger.info(&format!("位置: {}", config_path.display()), Some(8), Some(serde_json::json!({"op": 1, "field": "config_path", "path": config_path.display().to_string()})));
    app_state.logger.info(&format!("位置: {}", log_path), Some(11), Some(serde_json::json!({"field": "log_path", "path": log_path})));

    let app = Router::new()
        .route("/api/files", get(handle_files))
        .route("/api/files/open", post(handle_file_open))
        .route("/api/upload", post(handle_upload).layer(DefaultBodyLimit::max(upload_limit)))
        .route("/api/upload/check", post(handle_upload_check))
        .route("/api/download", get(handle_download))
        .route("/api/delete", delete(handle_delete))
        .route("/api/delete/batch", post(handle_delete_batch))
        .route("/api/roots", get(handle_roots_get).post(handle_roots_post).delete(handle_roots_delete))
        .route("/api/roots/rename", put(handle_roots_rename))
        .route("/api/config", get(handle_config_get).put(handle_config_put))
        .route("/api/open/logdir", post(handle_open_logdir))
        .route("/api/server-info", get(handle_server_info))
        .route("/api/logs", get(handle_logs_get).delete(handle_logs_delete))
        .route("/api/logs/display", delete(handle_logs_display_clear))
        .route("/api/logs/stream", get(handle_logs_stream))
        .route("/api/logs", post(handle_logs_post))
        .fallback(handle_fallback)
        .layer(CorsLayer::permissive())
        .with_state(app_state.clone());

    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap_or_else(|e| {
        eprintln!("[错误] 无法绑定端口 {}: {}", port, e);
        std::process::exit(1);
    });

    let local_ip = get_local_ip();
    let url = format!("http://{}:{}", local_ip, port);

    println!();
    println!("══════════════════════════════════════════");
    println!("  📁  LanDisk 服务已启动");
    println!("══════════════════════════════════════════");

    app_state.logger.info(&format!("[启动] 服务地址 : {}", url), Some(9), Some(serde_json::json!({"op": 1, "desc": "服务地址", "url": url})));
    app_state.logger.info(&format!("[启动] 编译时间 : {}", BUILD_TS), Some(9), Some(serde_json::json!({"op": 1, "desc": "编译时间", "buildTs": BUILD_TS})));
    if !roots.is_empty() {
        app_state.logger.info(&format!("共享目录 {} 个", roots.len()), Some(9), Some(serde_json::json!({"op": 1, "desc": "共享目录", "count": roots.len(), "dirs": roots})));
    }
    println!("══════════════════════════════════════════");
    println!();

    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>())
        .await
        .unwrap();
}
