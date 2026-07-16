use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;
use std::net::TcpStream;
use std::path::PathBuf;

use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

struct ServerProcess(Mutex<Option<Child>>);

impl Drop for ServerProcess {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.0.lock() {
            if let Some(ref mut child) = *guard {
                eprintln!("[清理] 关闭 Express 服务...");
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn find_server_js(app: &tauri::App) -> PathBuf {
    // Try resource directory first (production)
    if let Ok(dir) = app.path().resource_dir() {
        // Direct path (when resources are at root)
        let direct = dir.join("server.js");
        if direct.exists() {
            return direct;
        }
        // server-dist/ prefix (when bundled from ../server-dist/**)
        let bundled = dir.join("server-dist").join("server.js");
        if bundled.exists() {
            return bundled;
        }
    }
    // Fallback: CWD (dev mode)
    PathBuf::from("server.js")
}

fn ensure_server(app: &tauri::App) -> Option<Child> {
    let is_running = TcpStream::connect_timeout(
        &"127.0.0.1:3000".parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok();

    if is_running {
        eprintln!("[信息] API 服务已在运行");
        return None;
    }

    let server_js = find_server_js(app);
    eprintln!("[启动] Express API 服务: {}", server_js.display());

    match Command::new("node")
        .arg(&server_js)
        .current_dir(server_js.parent().unwrap_or(std::path::Path::new(".")))
        .spawn()
    {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("[错误] 无法启动 Node.js: {}", e);
            eprintln!("       请确认已安装 Node.js 且 server.js 存在于程序目录");
            None
        }
    }
}

fn wait_for_server(max_secs: u32) {
    for i in 0..(max_secs * 2) {
        if TcpStream::connect_timeout(
            &"127.0.0.1:3000".parse().unwrap(),
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
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            // 1. 后台启动 Express server，不阻塞 UI
            let child = ensure_server(app);
            app.manage(ServerProcess(Mutex::new(child)));

            // 后台检测 server 就绪（仅日志）
            std::thread::spawn(|| {
                wait_for_server(10);
            });

            // 2. 系统托盘
            let autostart_enabled = app.autolaunch().is_enabled().unwrap_or(false);
            let show_item = MenuItemBuilder::with_id("show", "显示窗口").build(app)?;
            let autostart_item = CheckMenuItemBuilder::with_id("autostart", "开机自启")
                .checked(autostart_enabled)
                .build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&autostart_item)
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
                    "autostart" => {
                        let autostart = app.autolaunch();
                        let enabled = autostart.is_enabled().unwrap_or(false);
                        if enabled {
                            let _ = autostart.disable();
                        } else {
                            let _ = autostart.enable();
                        }
                    }
                    "quit" => {
                        let state = app.state::<ServerProcess>();
                        if let Ok(mut guard) = state.0.lock() {
                            if let Some(ref mut child) = *guard {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
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
