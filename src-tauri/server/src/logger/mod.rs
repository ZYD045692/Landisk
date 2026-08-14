use chrono::Local;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tokio::sync::broadcast;

const MAX_BUFFER: usize = 200;
const MAX_FILE_SIZE: u64 = 1 * 1024 * 1024; // 1 MB
const LOG_FILE: &str = "landisk.log";

/// 日志条目（结构化）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(default)]
    pub message: String,
}

/// 日志文件格式
#[derive(Serialize, Deserialize)]
struct LogFileEntry {
    ts: String,
    level: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    r#type: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    msg: Option<String>,
}

pub struct Logger {
    ring_buffer: Mutex<Vec<LogEntry>>,
    log_dir: Mutex<Option<PathBuf>>,
    log_file: Mutex<Option<PathBuf>>,
    current_date: Mutex<Option<String>>,
    sse_tx: broadcast::Sender<LogEntry>,
}

impl Logger {
    pub fn new() -> Self {
        let (sse_tx, _) = broadcast::channel(256);
        Self {
            ring_buffer: Mutex::new(Vec::with_capacity(MAX_BUFFER)),
            log_dir: Mutex::new(None),
            log_file: Mutex::new(None),
            current_date: Mutex::new(None),
            sse_tx,
        }
    }

    pub fn init(&self, user_data_dir: &Path) {
        let log_dir = user_data_dir.join("logs");
        let log_file = log_dir.join(LOG_FILE);

        if fs::create_dir_all(&log_dir).is_ok() {
            *self.log_dir.lock().unwrap() = Some(log_dir.clone());
            *self.log_file.lock().unwrap() = Some(log_file.clone());
            *self.current_date.lock().unwrap() = Some(Local::now().format("%Y-%m-%d").to_string());
            self.load_from_file(100);
        }
    }

    fn load_from_file(&self, count: usize) {
        let log_file = self.log_file.lock().unwrap().clone();
        if let Some(path) = log_file {
            if let Ok(content) = fs::read_to_string(&path) {
                let mut entries = Vec::new();
                for block in content.split("\n\n").filter(|b| !b.is_empty()) {
                    if let Ok(parsed) = serde_json::from_str::<LogFileEntry>(block) {
                        entries.push(LogEntry {
                            timestamp: parsed.ts,
                            level: parsed.level,
                            r#type: parsed.r#type,
                            data: parsed.data,
                            message: parsed.msg.unwrap_or_default(),
                        });
                    }
                }
                let loaded: Vec<_> = entries.into_iter().rev().take(count).rev().collect();
                let mut buffer = self.ring_buffer.lock().unwrap();
                for e in loaded {
                    buffer.push(e);
                }
            }
        }
    }

    fn rotate_if_needed(&self) {
        let log_file = self.log_file.lock().unwrap().clone();
        let current_date = self.current_date.lock().unwrap().clone();
        let today = Local::now().format("%Y-%m-%d").to_string();

        // 日期变更
        if let Some(ref date) = current_date {
            if today != *date {
                self.archive(date);
                *self.current_date.lock().unwrap() = Some(today);
                return;
            }
        }

        // 大小超限
        if let Some(ref path) = log_file {
            if let Ok(meta) = fs::metadata(path) {
                if meta.len() > MAX_FILE_SIZE {
                    self.archive(&today);
                }
            }
        }
    }

    fn archive(&self, date_str: &str) {
        let log_file = self.log_file.lock().unwrap().clone();
        let log_dir = self.log_dir.lock().unwrap().clone();
        if let (Some(path), Some(dir)) = (log_file, log_dir) {
            let archived = dir.join(format!("landisk-{}.log", date_str));
            if archived.exists() {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(mut file) = fs::OpenOptions::new()
                        .append(true)
                        .create(true)
                        .open(&archived)
                    {
                        let _ = writeln!(file, "{}", content);
                    }
                }
                let _ = fs::remove_file(&path);
            } else {
                let _ = fs::rename(&path, &archived);
            }
        }
    }

    fn write_entry(&self, _level: &str, entry: LogEntry) {
        // 环形缓冲区
        {
            let mut buffer = self.ring_buffer.lock().unwrap();
            buffer.push(entry.clone());
            if buffer.len() > MAX_BUFFER {
                buffer.remove(0);
            }
        }

        // SSE 推流
        let _ = self.sse_tx.send(entry.clone());

        // 写入文件
        let log_file = self.log_file.lock().unwrap().clone();
        if let Some(ref path) = log_file {
            self.rotate_if_needed();
            let entry_data = entry.data.clone();
            let file_entry = LogFileEntry {
                ts: entry.timestamp.clone(),
                level: entry.level.clone(),
                r#type: entry.r#type,
                data: entry_data,
                msg: Some(entry.message.clone()),
            };
            if let Ok(json) = serde_json::to_string_pretty(&file_entry) {
                match fs::OpenOptions::new()
                    .append(true)
                    .create(true)
                    .open(path)
                {
                    Ok(mut file) => { let _ = writeln!(file, "{}\n", json); }
                    Err(e) => eprintln!("[日志] 写入文件失败: {}", e),
                }
            }
        }

        // 控制台输出
        let type_name = entry.r#type.and_then(|t| TYPE_NAMES.get(&t)).copied().unwrap_or("");
        let detail = entry.data.as_ref().map(|d| {
            if let Some(error) = d.get("error").and_then(|v| v.as_str()) {
                format!(" — {}", error)
            } else if let Some(dest) = d.get("dest").and_then(|v| v.as_str()) {
                format!(" → {}", dest)
            } else {
                String::new()
            }
        }).unwrap_or_default();
        let text = if type_name.is_empty() {
            format!("[{}] [{}] {}", entry.timestamp, entry.level, entry.message)
        } else {
            format!("[{}] [{}] [{}] {}{}", entry.timestamp, entry.level, type_name, entry.message, detail)
        };
        println!("{}", text);
    }

    pub fn info(&self, msg: &str, type_id: Option<u32>, data: Option<serde_json::Value>) {
        let entry = self.make_entry("INFO", msg, type_id, data);
        self.write_entry("INFO", entry);
    }

    pub fn warn(&self, msg: &str, type_id: Option<u32>, data: Option<serde_json::Value>) {
        let entry = self.make_entry("WARN", msg, type_id, data);
        self.write_entry("WARN", entry);
    }

    pub fn error(&self, msg: &str, type_id: Option<u32>, data: Option<serde_json::Value>) {
        let entry = self.make_entry("ERROR", msg, type_id, data);
        self.write_entry("ERROR", entry);
    }

    fn make_entry(&self, level: &str, msg: &str, type_id: Option<u32>, data: Option<serde_json::Value>) -> LogEntry {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
        LogEntry {
            timestamp,
            level: level.to_string(),
            r#type: type_id,
            data,
            message: msg.to_string(),
        }
    }

    pub fn get_buffer(&self, lines: usize, options: &LogQuery) -> Vec<LogEntry> {
        let buffer = self.ring_buffer.lock().unwrap();
        let mut result: Vec<LogEntry> = buffer.iter()
            .filter(|e| {
                if let Some(ref level) = options.level {
                    if e.level != *level { return false; }
                }
                if let Some(ref search) = options.search {
                    if !e.message.to_lowercase().contains(&search.to_lowercase()) { return false; }
                }
                true
            })
            .cloned()
            .collect();
        let len = result.len();
        result.drain(..len.saturating_sub(lines));
        result
    }

    pub fn clear_ring_buffer(&self) {
        self.ring_buffer.lock().unwrap().clear();
    }

    pub fn clear_buffer(&self) -> Result<(), String> {
        self.ring_buffer.lock().unwrap().clear();
        if let Some(ref dir) = *self.log_dir.lock().unwrap() {
            let entries = fs::read_dir(dir).map_err(|e| format!("无法读取日志目录: {}", e))?;
            for entry in entries {
                let entry = entry.map_err(|e| format!("读取目录项失败: {}", e))?;
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with("landisk") && name_str.ends_with(".log") {
                    fs::remove_file(entry.path())
                        .map_err(|e| format!("删除 {} 失败: {}", name_str, e))?;
                }
            }
        }
        Ok(())
    }

    pub fn sse_receiver(&self) -> broadcast::Receiver<LogEntry> {
        self.sse_tx.subscribe()
    }

    pub fn get_log_path(&self) -> Option<PathBuf> {
        self.log_file.lock().unwrap().clone()
    }
}

#[derive(Default)]
pub struct LogQuery {
    pub level: Option<String>,
    pub search: Option<String>,
}

use std::sync::LazyLock;

static TYPE_NAMES: LazyLock<std::collections::HashMap<u32, &'static str>> = LazyLock::new(|| {
    let mut m = std::collections::HashMap::new();
        m.insert(2, "替换");
        m.insert(3, "阻断");
        m.insert(4, "删除");
        m.insert(5, "下载");
        m.insert(6, "打开");
        m.insert(7, "根目录");
        m.insert(8, "配置");
        m.insert(9, "启动");
        m.insert(10, "浏览");
        m.insert(11, "日志");
        m.insert(12, "服务");
        m.insert(13, "预览");
        m
    });
