const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { resolveSafePath } = require('../middleware/pathSafety');

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
      // 确保目标目录存在
      fs.mkdirSync(resolved.absolutePath, { recursive: true });
      cb(null, resolved.absolutePath);
    },
    filename: (req, file, cb) => {
      const originalName = fixEncoding(file.originalname);
      const userPath = req.body.targetPath || '/';
      const resolved = resolveSafePath(userPath, config.roots);
      const destPath = resolved.valid ? resolved.absolutePath : '';
      const replaceList = (req.body.replace || '').split(',').map(s => s.trim()).filter(Boolean);


      let finalName = originalName;
      if (destPath) {
        const fullPath = path.join(destPath, finalName);
        if (replaceList.includes(originalName) && fs.existsSync(fullPath)) {
          try { fs.unlinkSync(fullPath); } catch {}
        } else {
          let counter = 1;
          const ext = path.extname(originalName);
          const base = path.basename(originalName, ext);
          while (fs.existsSync(path.join(destPath, finalName))) {
            finalName = `${base} (${counter})${ext}`;
            counter++;
          }
        }
      }
      cb(null, finalName);
    }
  });

  // 拦截可执行文件（防御性措施）
  const blockedExts = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll', '.sys', '.vbs', '.scr'];
  const fileFilter = (req, file, cb) => {
    const originalName = fixEncoding(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    if (blockedExts.includes(ext)) {
      return cb(new Error(`File type not allowed: ${ext}`), false);
    }
    cb(null, true);
  };

  const upload = multer({
    storage,
    fileFilter,
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

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: '没有选择文件' });
      }

      const replaceList = (req.body.replace || '').split(',').map(s => s.trim()).filter(Boolean);
      let replaced = 0, uploaded = 0;
      const files = req.files.map(f => {
        const name = fixEncoding(f.filename);
        const originalName = fixEncoding(f.originalname);
        if (replaceList.includes(originalName)) {
          replaced++;
          return { name, originalName, size: f.size, action: 'replaced' };
        }
        uploaded++;
        return { name, originalName, size: f.size, action: name === originalName ? 'new' : 'kept' };
      });

      const parts = [];
      if (uploaded > 0) parts.push(`新增 ${uploaded} 个`);
      if (replaced > 0) parts.push(`替换 ${replaced} 个`);

      res.json({ message: parts.join('，'), files });
    });
  });

  return router;
}

module.exports = { createUploadRouter };
