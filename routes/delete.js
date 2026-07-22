const express = require('express');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { resolveSafePath } = require('../middleware/pathSafety');
const logger = require('../utils/logger');

function moveToTrash(absPath, isDir) {
  return new Promise((resolve, reject) => {
    const method = isDir ? 'DeleteDirectory' : 'DeleteFile';
    // 用 -EncodedCommand 传 Base64（UTF16LE），避免路径特殊字符注入
    const script = `Add-Type -AssemblyName Microsoft.VisualBasic;[Microsoft.VisualBasic.FileIO.FileSystem]::${method}('${absPath}','OnlyErrorDialogs','SendToRecycleBin')`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell', ['-EncodedCommand', encoded], { timeout: 10000 }, (err) => {
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
        logger.info({ message: `${resolved.absolutePath} → trash`, type: 4, data: { op: 1, file: resolved.absolutePath, dest: 'trash' } });
        return res.json({ message: '已移入回收站', dest: 'trash' });
      } catch {
        // 回收站失败则永久删除
        logger.warn({ message: `${resolved.absolutePath} → permanent`, type: 4, data: { op: 2, file: resolved.absolutePath, dest: 'permanent' } });
        if (stat.isDirectory()) {
          await fs.rm(resolved.absolutePath, { recursive: true });
        } else {
          await fs.unlink(resolved.absolutePath);
        }
        return res.json({ message: '已永久删除（回收站不可用）', dest: 'permanent' });
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.warn({ message: `${resolved.absolutePath} — not found`, type: 4, data: { op: 3, file: resolved.absolutePath, error: 'not found' } });
        return res.status(404).json({ error: 'Not found' });
      }
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        logger.warn({ message: `${resolved.absolutePath} — permission denied`, type: 4, data: { op: 3, file: resolved.absolutePath, error: 'permission denied' } });
        return res.status(403).json({ error: 'Permission denied' });
      }
      logger.error({ message: `${resolved.absolutePath} — ${err.message}`, type: 4, data: { op: 3, file: resolved.absolutePath, error: err.message } });
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  return router;
}

module.exports = { createDeleteRouter };
