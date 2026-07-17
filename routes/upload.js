const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { resolveSafePath } = require('../middleware/pathSafety');
const logger = require('../utils/logger');

// 修复中文文件名：multer 将 UTF-8 字节误读为 latin1
function fixEncoding(raw) {
  return Buffer.from(raw, 'latin1').toString('utf8');
}

function createUploadRouter(config) {
  const router = express.Router();

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const userPath = req.body.targetPath || '/';
      const resolved = resolveSafePath(userPath, config.roots);
      if (!resolved.valid) {
        return cb(new Error('Access denied'), null);
      }
      // 存到 req 上，给 filename 回调复用，避免重复 resolveSafePath
      req._safePath = resolved.absolutePath;
      // 确保目标目录存在
      fs.mkdirSync(req._safePath, { recursive: true });
      cb(null, req._safePath);
    },
    filename: (req, file, cb) => {
      const originalName = fixEncoding(file.originalname);

      // 只算一次 replaceList，后续的 filename 回调和 handler 复用
      if (!req._replaceList) {
        req._replaceList = (req.body.replace || '').split(',').map(s => s.trim()).filter(Boolean);
      }

      let finalName = originalName;
      if (req._safePath) {
        const fullPath = path.join(req._safePath, finalName);
        if (req._replaceList.includes(originalName) && fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch {}
        } else {
          let counter = 1;
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          while (fs.existsSync(path.join(req._safePath, finalName))) {
            finalName = `${base} (${counter})${ext}`;
            counter++;
          }
        }
      }
      cb(null, finalName);
    }
  });

  const upload = multer({
    storage,
    limits: {
      fileSize: (config.maxFileSizeMB || 500) * 1024 * 1024
    }
  });

  router.post('/check', (req, res) => {
    const userPath = req.body.targetPath || '/';
    const resolved = resolveSafePath(userPath, config.roots);
    if (!resolved.valid) return res.status(403).json({ error: resolved.error });
    const names = req.body.names || [];
    const conflicts = names.filter(n => fs.existsSync(path.join(resolved.absolutePath, n)));
    res.json({ conflicts });
  });

  router.post('/', (req, res) => {
    if (config.roots.length === 0) {
      return res.status(400).json({ error: '请先添加共享目录' });
    }
    upload.any()(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
              error: `文件过大，最大允许 ${config.maxFileSizeMB} MB`
            });
          }
          return res.status(400).json({ error: err.message });
        }
        return res.status(400).json({ error: err.message });
      }

      const blockedExts = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll', '.sys', '.vbs', '.scr'];

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '没有选择文件' });
      }

      let replaced = 0, uploaded = 0, blocked = 0;

      // 删除被阻止的文件
      const safeFiles = [];
      for (const f of req.files) {
        const ext = path.extname(f.filename).toLowerCase();
        if (blockedExts.includes(ext)) {
          try { fs.unlinkSync(f.path); } catch {}
          blocked++;
          continue;
        }
        safeFiles.push(f);
      }

      const files = safeFiles.map(f => {
        // filename 回调里已用 fixEncoding 转了一次，直接取
        const name = f.filename;
        const originalName = fixEncoding(f.originalname);
        if (req._replaceList.includes(originalName)) {
          replaced++;
          return { name, originalName, size: f.size, action: 'replaced' };
        }
        uploaded++;
        return { name, originalName, size: f.size, action: name === originalName ? 'new' : 'kept' };
      });

      const parts = [];
      if (uploaded > 0) parts.push(`新增 ${uploaded} 个`);
      if (replaced > 0) parts.push(`替换 ${replaced} 个`);
      if (blocked > 0) parts.push(`${blocked} 个文件类型不安全已跳过`);
      logger.info(`上传完成: ${parts.join('，')} - ${files.map(f => f.name).join(', ')}`);

      res.json({ message: parts.join('，'), files });
    });
  });

  return router;
}

module.exports = { createUploadRouter };
