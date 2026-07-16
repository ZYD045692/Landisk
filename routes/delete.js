const express = require('express');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { resolveSafePath } = require('../middleware/pathSafety');

function moveToTrash(absPath, isDir) {
  return new Promise((resolve, reject) => {
    const safe = absPath.replace(/'/g, "''");
    const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${safe}','OnlyErrorDialogs','SendToRecycleBin')`;
    execFile('powershell', ['-Command', ps], { timeout: 10000 }, (err) => {
      err ? reject(err) : resolve();
    });
  });
}

function createDeleteRouter(config) {
  const router = express.Router();

  router.delete('/', async (req, res) => {
    const userPath = req.query.path;
    if (!userPath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }
    if (config.roots.length === 0) {
      return res.status(400).json({ error: '请先添加共享目录' });
    }

    const resolved = resolveSafePath(userPath, config.roots);
    if (!resolved.valid) {
      return res.status(403).json({ error: resolved.error });
    }

    try {
      const stat = await fs.stat(resolved.absolutePath);
      try {
        await moveToTrash(resolved.absolutePath, stat.isDirectory());
        return res.json({ message: '已移入回收站' });
      } catch {
        // 回收站失败则永久删除
        if (stat.isDirectory()) {
          await fs.rm(resolved.absolutePath, { recursive: true });
        } else {
          await fs.unlink(resolved.absolutePath);
        }
        return res.json({ message: '已永久删除（回收站不可用）' });
      }
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      if (err.code === 'EACCES' || err.code === 'EPERM') return res.status(403).json({ error: 'Permission denied' });
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  return router;
}

module.exports = { createDeleteRouter };
