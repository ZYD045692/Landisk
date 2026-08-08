/// 编译时间戳：把「本次编译时间」嵌入二进制，供后端在启动日志 / server-info 中返回，
/// 用于判断运行中的后端是否是最新编译的（dev watch 的 mtime 检测在 Windows 上可能漏检）。
///
/// 注意：**不要**加 `cargo:rerun-if-changed`，这样 cargo 会在任意源码文件变更时重跑本脚本，
/// BUILD_TS 始终反映最后一次真实编译的时间；若 cargo watch 漏检没有重编，BUILD_TS 保持旧值，
/// 用户一看便知后端是旧的。
use chrono::Local;

fn main() {
    let ts = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    println!("cargo:rustc-env=BUILD_TS={}", ts);
}
