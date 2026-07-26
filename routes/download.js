const express = require('express');
const fs = require('fs/promises');
const { createReadStream } = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { resolveSafePath } = require('../middleware/pathSafety');
const logger = require('../utils/logger');

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// MIME 类型映射
const MIME_TYPES = {
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.apk': 'application/vnd.android.package-archive',
  '.ipa': 'application/octet-stream'
};

function createDownloadRouter(config) {
  const router = express.Router();

  router.get('/', async (req, res) => {
    const userPath = req.query.path;
    if (!userPath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }
    if (config.roots.length === 0) {
      return res.status(400).json({ error: '请先添加共享目录' });
    }

    const rootIdx = parseInt(req.query.root);
    if (isNaN(rootIdx) || !config.roots[rootIdx]) {
      logger.warn(`[下载] 无效根目录索引: root=${req.query.root}, roots=${config.roots.length}`);
      return res.status(400).json({ error: '无效的根目录' });
    }
    const resolved = resolveSafePath(userPath, [config.roots[rootIdx]]);
    if (!resolved.valid) {
      return res.status(403).json({ error: resolved.error });
    }

    try {
      const stat = await fs.stat(resolved.absolutePath);

      if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Cannot download a directory' });
      }

      const ext = path.extname(resolved.absolutePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const filename = encodeURIComponent(path.basename(resolved.absolutePath));

      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stat.size);

      const displayName = path.basename(resolved.absolutePath);
      logger.info({ message: `${displayName} (${formatSize(stat.size)})`, type: 5, data: { op: 1, file: displayName, size: formatSize(stat.size) } });
      await pipeline(createReadStream(resolved.absolutePath), res);
    } catch (err) {
      if (err.code === 'ENOENT') {
        logger.warn({ message: `${path.basename(resolved.absolutePath)} — not found`, type: 5, data: { op: 2, file: path.basename(resolved.absolutePath), error: 'not found' } });
        return res.status(404).json({ error: 'File not found' });
      }
      if (err.code === 'EACCES') {
        logger.warn({ message: `${path.basename(resolved.absolutePath)} — permission denied`, type: 5, data: { op: 2, file: path.basename(resolved.absolutePath), error: 'permission denied' } });
        return res.status(403).json({ error: 'Permission denied' });
      }
      // pipeline 错误：如果响应头已发送（下载中断），不覆盖已发出的响应
      if (!res.headersSent) {
        logger.error({ message: `${path.basename(resolved.absolutePath)} — ${err.message}`, type: 5, data: { op: 2, file: path.basename(resolved.absolutePath), error: err.message } });
        res.status(500).json({ error: 'Error reading file' });
      }
    }
  });

  return router;
}

module.exports = { createDownloadRouter };
