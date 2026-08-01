use std::process::Command;
use std::time::Duration;
use std::net::TcpStream;
use std::path::PathBuf;
use std::os::windows::process::CommandExt;
use std::sync::Mutex;

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
#[cfg_attr(debug_assertions, allow(unused_imports))]
use tauri_plugin_shell::ShellExt;

struct SidecarPid(Mutex<Option<u32>>);

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

fn get_config_port() -> u16 {
    // config 在同级目录下（安装目录）
    let config_path = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("config.json")))
        .unwrap_or_else(|| PathBuf::from("config.json"));
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

    // Dev fallback: 尝试 sidecar
    let sidecar_path = PathBuf::from("binaries/landisk-server-x86_64-pc-windows-msvc.exe");
    let static_dir_dev = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("client").join("dist"))
        .unwrap_or_else(|| PathBuf::from("../client/dist"));
    let static_arg = format!("--static-dir={}", static_dir_dev.to_string_lossy());

    // dev 模式下配置写到项目根目录 dev-data/，避免 Tauri 文件监听死循环
    let data_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("dev-data"))
        .unwrap_or_else(|| PathBuf::from("../dev-data"));
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
            .disable_drag_drop_handler()
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
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error running tauri");
}
