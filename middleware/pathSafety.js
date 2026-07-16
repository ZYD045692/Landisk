const path = require('path');

/**
 * 路径安全解析 — 防止目录穿越攻击
 *
 * @param {string} userPath - 用户输入的相对路径
 * @param {string[]} roots - 配置的根目录列表（绝对路径）
 * @returns {{ valid: true, absolutePath: string } | { valid: false, error: string }}
 */
function resolveSafePath(userPath, roots) {
  // 规范化用户路径：空或 "/" 视为根目录
  let normalized = (userPath || '').trim();
  if (normalized === '' || normalized === '/') {
    normalized = '.';
  } else {
    // 移除开头的 /，规范化，去除 ../
    normalized = path.normalize(normalized.replace(/^\/+/, '')).replace(/^(\.\.(\/|\\|$))+/, '');
  }

  for (const root of roots) {
    const candidate = path.resolve(root, normalized);
    // 必须严格以 root + 分隔符开头（防止 D:/Shared 匹配 D:/SharedSecret）
    if (candidate.startsWith(root + path.sep) || candidate === root) {
      return { valid: true, absolutePath: candidate };
    }
  }

  return { valid: false, error: 'Access denied: path outside allowed directories' };
}

module.exports = { resolveSafePath };
