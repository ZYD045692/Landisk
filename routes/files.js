const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { resolveSafePath } = require('../middleware/pathSafety');
const logger = require('../utils/logger');

function createFilesRouter(config) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const userPath = req.query.path || '/';

    // 选择活跃根目录：root 参数指定索引，默认第一个
    const rootIndex = parseInt(req.query.root);
    const activeRoots = (!isNaN(rootIndex) && config.roots[rootIndex])
      ? [config.roots[rootIndex]]
      : config.roots;

    if (activeRoots.length === 0) {
      return res.json({ currentPath: '/', isDirectory: true, entries: [] });
    }

    const resolved = resolveSafePath(userPath, activeRoots);

    if (!resolved.valid) {
      return res.status(403).json({ error: resolved.error });
    }

    try {
      const stat = await fs.stat(resolved.absolutePath);

      if (!stat.isDirectory()) {
        // 如果路径指向文件，返回单个文件信息
        return res.json({
          currentPath: userPath,
          isDirectory: false,
          entries: [{
            name: path.basename(resolved.absolutePath),
            size: stat.size,
            modified: stat.mtime.toISOString(),
            isDirectory: false,
            extension: path.extname(resolved.absolutePath).toLowerCase()
          }]
        });
      }

      const dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });

      // 过滤隐藏文件 + 并行 stat（取代串行逐条查询）
      const visible = dirents.filter(d => config.showHiddenFiles || !d.name.startsWith('.'));
      const results = await Promise.allSettled(
        visible.map(async (dirent) => {
          const fullPath = path.join(resolved.absolutePath, dirent.name);
          const entryStat = await fs.stat(fullPath);
          return {
            name: dirent.name,
            size: entryStat.size,
            modified: entryStat.mtime.toISOString(),
            isDirectory: dirent.isDirectory(),
            extension: dirent.isDirectory() ? null : path.extname(dirent.name).toLowerCase(),
            fullPath
          };
        })
      );
      // 仅保留成功的 stat（跳过权限不足、损坏的符号链接等）
      const entries = results.filter(r => r.status === 'fulfilled').map(r => r.value);

      // 排序：目录优先 → 名称字母序（兼容中文）
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      res.json({
        currentPath: userPath,
        isDirectory: true,
        entries
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Path not found' });
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        return res.status(403).json({ error: 'Permission denied' });
      }
      logger.error('读取目录失败:', resolved.absolutePath, err.message);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

module.exports = { createFilesRouter };
