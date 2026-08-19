use std::process::Command;
use std::time::Duration;
use std::net::TcpStream;
use std::path::PathBuf;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU16, Ordering};

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
#[cfg_attr(debug_assertions, allow(unused_imports))]
use tauri_plugin_shell::ShellExt;

struct SidecarPid(Mutex<Option<u32>>);

/// 拖拽诊断：记录 DragDropEvent 到后端日志（用于定位 no-drop 是 wry 层拦截还是前端未处理）
static DRAG_LOG_PORT: AtomicU16 = AtomicU16::new(0);

// 包装 child 进程，drop 时自动 kill
struct SidecarProcess(Mutex<Option<std::process::Child>>);
impl Drop for SidecarProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

/// dev 模式数据目录：与 ensure_server 传给 sidecar 的一致（exe 上溯三级 = 仓库根 → dev-data）。
/// dev 与打包的端口必须同源，否则壳注入的前端端口与 sidecar 实际端口不一致。
fn dev_data_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .map(|d| d.join("..").join("..").join(".."))
        .and_then(|p| std::fs::canonicalize(&p).ok())
        .map(|p| {
            let s = p.to_string_lossy();
            let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
            PathBuf::from(s.to_string()).join("dev-data")
        })
        .unwrap_or_else(|| PathBuf::from("dev-data"))
}

fn get_config_port() -> u16 {
    // 优先级：LANDISK_DATA_DIR（用户显式）→ dev 模式仓库根/dev-data（与 ensure_server 一致）→ 程序所在目录
    let config_dir = std::env::var("LANDISK_DATA_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            let d = dev_data_dir();
            if d.join("config.json").exists() {
                Some(d)
            } else {
                None
            }
        })
        .or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf())))
        .unwrap_or_else(|| PathBuf::from("."));
    let config_path = config_dir.join("config.json");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(port) = v.get("port").and_then(|p| p.as_u64()) {
                return port as u16;
            }
        }
    }
    22580
}

#[cfg_attr(debug_assertions, allow(unused_variables))]
fn ensure_server(app: &tauri::AppHandle, port: u16) -> Option<u32> {
    // dev 模式：先杀旧 sidecar，避免端口被残留进程占用
    #[cfg(debug_assertions)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "landisk-server-x86_64-pc-windows-msvc.exe"])
            .creation_flags(0x08000000)
            .output();
        std::thread::sleep(Duration::from_millis(200));
    }

    let addr = format!("127.0.0.1:{}", port);
    if TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
    {
        eprintln!("[信息] API 服务已在端口 {} 运行", port);
        return None;
    }

    // Production: Rust sidecar
    #[cfg(not(debug_assertions))]
    {
        let resource_dir = app.path().resource_dir().expect("resource dir");
        let static_dir = if resource_dir.join("_up_").exists() {
            resource_dir.join("_up_").join("client").join("dist")
        } else if resource_dir.join("client").join("dist").exists() {
            resource_dir.join("client").join("dist")
        } else {
            resource_dir.join("_up_").join("client").join("dist")
        };
        let static_arg = format!("--static-dir={}", static_dir.display());

        eprintln!("[启动] sidecar: landisk-server (端口 {})", port);
        eprintln!("[启动] 静态目录: {}", static_dir.display());

        match app.shell().sidecar("landisk-server") {
            Ok(cmd) => match cmd.args([&static_arg]).spawn() {
                Ok((_rx, child)) => {
                    return Some(child.pid());
                }
                Err(e) => {
                    eprintln!("[错误] 无法启动 sidecar: {}", e);
                }
            },
            Err(e) => {
                eprintln!("[错误] 无法创建 sidecar 命令: {}", e);
            }
        }
        eprintln!("[信息] 尝试 node 回退...");
    }

    // Dev fallback: 尝试 sidecar（路径相对 exe 所在目录解析，不依赖 CWD；
    // 避免被开机自启/快捷方式以 System32 为 CWD 拉起时找不到 binaries/client/dist/dev-data）
    let exe_dir = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.to_path_buf()));
    // 项目根 = exe_dir 上溯三级（target/{debug,release} → 仓库根），canonicalize 归一化 ".."
    // Windows canonicalize 返回 `\\?\` 前缀的 verbatim 路径，去掉它避免传给 sidecar 的路径带 `\\?\`
    let project_root = exe_dir
        .as_deref()
        .map(|d| d.join("..").join("..").join(".."))
        .and_then(|p| std::fs::canonicalize(&p).ok())
        .map(|p| {
            let s = p.to_string_lossy();
            let s = s.strip_prefix(r"\\?\").unwrap_or(&s);
            PathBuf::from(s.to_string())
        })
        .unwrap_or_else(|| PathBuf::from("."));
    let sidecar_path = project_root
        .join("src-tauri").join("binaries").join("landisk-server-x86_64-pc-windows-msvc.exe");
    let static_dir_dev = project_root.join("client").join("dist");
    let static_arg = format!("--static-dir={}", static_dir_dev.to_string_lossy());

    // dev 模式下配置写到项目根目录 dev-data/
    let data_dir = project_root.join("dev-data");
    eprintln!("[启动] sidecar (dev): {}", sidecar_path.display());
    eprintln!("[启动] 静态目录: {}", static_dir_dev.display());
    eprintln!("[启动] 数据目录: {}", data_dir.display());
    match Command::new(&sidecar_path)
        .args([&static_arg])
        .env("LANDISK_DATA_DIR", data_dir.to_string_lossy().as_ref())
        .creation_flags(0x08000000)
        .spawn()
    {
        Ok(child) => {
            let pid = child.id();
            // 存入 managed state，Tauri 退出时自动 kill
            app.manage(SidecarProcess(Mutex::new(Some(child))));
            return Some(pid);
        }
        Err(e) => eprintln!("[错误] 无法启动 sidecar: {}", e),
    }

    // fallback: node server.js
    let server_js = PathBuf::from("../server.js");
    if server_js.exists() {
        eprintln!("[启动] Express API (dev): {}", server_js.display());
        match Command::new("node")
            .arg(&server_js)
            .creation_flags(0x08000000)
            .spawn()
        {
            Ok(child) => return Some(child.id()),
            Err(e) => eprintln!("[错误] 无法启动 Node.js: {}", e),
        }
    }
    eprintln!("[错误] 无法启动后端服务");
    None
}

fn wait_for_server(max_secs: u32, port: u16) {
    let addr = format!("127.0.0.1:{}", port);
    for i in 0..(max_secs * 2) {
        if TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(500),
        )
        .is_ok()
        {
            eprintln!("[就绪] API 服务已启动 (耗时 {} 秒)", (i + 1) / 2);
            return;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    eprintln!("[警告] API 服务启动超时 ({} 秒)，继续启动界面...", max_secs);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .arg("--hidden")
                .build(),
        )
        .setup(|app| {
            let p = get_config_port();
            DRAG_LOG_PORT.store(p, Ordering::Relaxed);
            eprintln!("[配置] 读取端口: {}", p);
            let is_autostart = std::env::args().any(|a| a == "--hidden");

            let init_js = format!("window.__LANDISK_PORT__={};", p);
            let _win = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::default(),
            )
            .title("LanDisk")
            .visible(!is_autostart)
            .focused(!is_autostart)
            .inner_size(1000.0, 602.0)
            .min_inner_size(820.0, 500.0)
            .resizable(true)
            .center()
            .initialization_script(&init_js)
            .build()?;

            let _pid = ensure_server(app.handle(), p);
            app.manage(SidecarPid(Mutex::new(_pid)));

            std::thread::spawn(move || {
                wait_for_server(10, p);
            });

            // 系统托盘
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let icon = app.default_window_icon().unwrap().clone();

            TrayIconBuilder::new()
                .icon(icon)
                .tooltip("LanDisk")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        // 先杀掉 sidecar 进程
                        let state = app.try_state::<SidecarPid>();
                        let sidecar_pid = match state {
                            Some(s) => match s.0.lock() {
                                Ok(guard) => *guard,
                                Err(_) => None,
                            },
                            None => None,
                        };
                        if let Some(pid) = sidecar_pid {
                            let _ = Command::new("taskkill")
                                .args(["/PID", &pid.to_string(), "/F"])
                                .creation_flags(0x08000000)
                                .spawn();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                // 壳内原生拖拽：Tauri 接管 OS 拖拽事件（DOM dragover/drop 不再触发），
                // 把绝对路径 + isDir 通过 eval 派发 DOM CustomEvent 给前端（landisk-drop / landisk-dragover）
                WindowEvent::DragDrop(dd) => {
                    log_drag_event(dd);
                    let js = match dd {
                        tauri::DragDropEvent::Drop { paths, .. } => {
                            let payload: Vec<serde_json::Value> = paths.iter().map(|p| {
                                serde_json::json!({ "path": p.to_string_lossy().to_string(), "isDir": p.is_dir() })
                            }).collect();
                            format!(
                                "window.dispatchEvent(new CustomEvent('landisk-drop',{{detail:{}}}));window.dispatchEvent(new CustomEvent('landisk-dragover',{{detail:false}}));",
                                serde_json::to_string(&payload).unwrap_or_else(|_| "[]".to_string())
                            )
                        }
                        tauri::DragDropEvent::Enter { .. } | tauri::DragDropEvent::Over { .. } => {
                            "window.dispatchEvent(new CustomEvent('landisk-dragover',{detail:true}));".to_string()
                        }
                        tauri::DragDropEvent::Leave => {
                            "window.dispatchEvent(new CustomEvent('landisk-dragover',{detail:false}));".to_string()
                        }
                        _ => String::new(),
                    };
                    if !js.is_empty() {
                        if let Some(wv) = window.get_webview_window("main") {
                            let _ = wv.eval(js);
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error running tauri");
}

/// 拖拽诊断：把 DragDropEvent 事件 POST 到后端日志（type=12），前端日志查看器可见。
/// 遇到 no-drop 时：日志里「没有」拖拽记录 → wry 层拦截（GetData 提取路径失败）；
/// 「有」记录但拖拽无效 → 前端未处理。
fn log_drag_event(dd: &tauri::DragDropEvent) {
    let port = DRAG_LOG_PORT.load(Ordering::Relaxed);
    if port == 0 {
        return;
    }
    let desc = match dd {
        tauri::DragDropEvent::Enter { paths, .. } => format!("拖拽进入 {} 个路径", paths.len()),
        tauri::DragDropEvent::Over { .. } => "拖拽移动".to_string(),
        tauri::DragDropEvent::Leave => "拖拽离开".to_string(),
        tauri::DragDropEvent::Drop { paths, .. } => format!("拖拽放下 {} 个路径", paths.len()),
        _ => "其他".to_string(),
    };
    let body = serde_json::json!({
        "level": "info",
        "type": 12,
        "data": { "op": 1, "desc": "拖拽诊断", "error": desc }
    })
    .to_string();
    // 手动 HTTP POST 到后端日志（零依赖；localhost 快，500ms 内完成）
    use std::io::Write;
    if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(200)));
        let req = format!(
            "POST /api/logs HTTP/1.1\r\nHost: localhost:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            port,
            body.len(),
            body
        );
        let _ = stream.write_all(req.as_bytes());
    }
}
