use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 共享根目录：name 唯一（虚拟路径用），path 为绝对路径
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RootEntry {
    #[serde(default)]
    pub name: String,
    pub path: String,
}

/// 应用配置，对应 config.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub roots: Vec<RootEntry>,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_max_file_size")]
    pub max_file_size_mb: u64,
    #[serde(default)]
    pub show_hidden_files: bool,
}

fn default_port() -> u16 { 22580 }
fn default_max_file_size() -> u64 { 500 }

impl Default for Config {
    fn default() -> Self {
        Self {
            roots: vec![],
            port: 22580,
            max_file_size_mb: 500,
            show_hidden_files: false,
        }
    }
}

/// 加载配置：从 data_dir/config.json 读取，不存在或格式不合法则返回默认值
pub fn load_config(data_dir: &Path) -> (Config, PathBuf) {
    let _ = fs::create_dir_all(data_dir);
    let config_path = data_dir.join("config.json");

    let config = fs::read_to_string(&config_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Config>(&s).ok())
        .unwrap_or_default();

    // 规范化根目录路径（保留 name）
    let mut config = config;
    for r in &mut config.roots {
        let p = PathBuf::from(&r.path);
        if p.is_absolute() {
            r.path = dunce::canonicalize(&p).unwrap_or(p).to_string_lossy().to_string();
        }
        if r.name.trim().is_empty() {
            r.name = Path::new(&r.path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
        }
    }

    // 过滤不存在的根目录
    config.roots.retain(|r| Path::new(&r.path).exists());

    // 写入默认配置（首次运行）
    let _ = fs::write(&config_path, serde_json::to_string_pretty(&config).unwrap());

    (config, config_path)
}
