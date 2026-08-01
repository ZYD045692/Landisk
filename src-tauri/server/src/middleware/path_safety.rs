use std::path::{Path, PathBuf};

/// 路径安全解析 — 防止目录穿越攻击
pub fn resolve_safe_path(user_path: &str, roots: &[String]) -> Result<PathBuf, String> {
    let normalized = user_path.trim().to_string();
    if normalized.is_empty() || normalized == "/" {
        // 根目录
        for root in roots {
            return Ok(PathBuf::from(root));
        }
        return Err("No roots configured".to_string());
    }

    // 如果是绝对路径（含盘符或 / 开头），直接检查是否在某个根下
    let path = Path::new(&normalized);
    if path.is_absolute() {
        for root in roots {
            let root_p = Path::new(root);
            // 用 canonicalize 统一盘符大小写再比较
            if let Ok(can_path) = dunce::canonicalize(path) {
                if let Ok(can_root) = dunce::canonicalize(root_p) {
                    let p_str = can_path.to_string_lossy().to_lowercase();
                    let r_str = can_root.to_string_lossy().to_lowercase();
                    if p_str == r_str || p_str.starts_with(&format!("{}\\", r_str)) || p_str.starts_with(&format!("{}/", r_str)) {
                        return Ok(can_path);
                    }
                }
            }
            // fallback: 直接字符串比较
            let p_str = path.to_string_lossy().to_lowercase();
            let r_str = root_p.to_string_lossy().to_lowercase();
            let r_prefix = r_str.trim_end_matches('\\').trim_end_matches('/').to_string();
            if p_str == r_prefix.as_str()
                || p_str.starts_with(&format!("{}\\", r_prefix))
                || p_str.starts_with(&format!("{}/", r_prefix))
            {
                return Ok(path.to_path_buf());
            }
        }
        return Err("Access denied: path outside allowed directories".to_string());
    }

    // 相对路径：拼接到根下检查
    let clean_path = clean_relative_path(&normalized);
    for root in roots {
        let root_path = Path::new(root);
        let candidate = root_path.join(&clean_path);
        let candidate_str = candidate.to_string_lossy().to_lowercase();
        let r_prefix = root.trim_end_matches('\\').trim_end_matches('/').to_lowercase();
        if candidate_str == r_prefix
            || candidate_str.starts_with(&format!("{}\\", r_prefix))
            || candidate_str.starts_with(&format!("{}/", r_prefix))
        {
            return Ok(candidate);
        }
    }
    Err("Access denied: path outside allowed directories".to_string())
}

/// 清理相对路径中的 ../ 和重复分隔符
fn clean_relative_path(input: &str) -> String {
    // 去掉开头的 / 或 \
    let s = input.trim_start_matches('/').trim_start_matches('\\');
    let p = Path::new(s);
    let components: Vec<_> = p.components().collect();
    let mut clean = Vec::new();
    for comp in components {
        match comp.as_os_str().to_str() {
            Some("..") => { clean.pop(); }
            Some(".") | Some("") | Some("\\") | Some("/") => {}
            Some(s) => { clean.push(s.to_string()); }
            None => {}
        }
    }
    clean.join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_path() {
        let roots = vec!["C:\\Shared".to_string()];
        assert!(resolve_safe_path("/", &roots).is_ok());
        assert!(resolve_safe_path("", &roots).is_ok());
    }

    #[test]
    fn test_absolute_path() {
        let roots = vec!["C:\\Shared".to_string()];
        assert!(resolve_safe_path("C:\\Shared\\subdir\\file.txt", &roots).is_ok());
    }

    #[test]
    fn test_absolute_path_denied() {
        let roots = vec!["C:\\Shared".to_string()];
        assert!(resolve_safe_path("C:\\Windows\\system32", &roots).is_err());
    }

    #[test]
    fn test_subdirectory() {
        let roots = vec!["C:\\Shared".to_string()];
        assert!(resolve_safe_path("/subdir", &roots).is_ok());
    }

    #[test]
    fn test_path_traversal_denied() {
        let roots = vec!["C:\\Shared".to_string()];
        assert!(resolve_safe_path("/../Windows", &roots).is_err());
    }
}
