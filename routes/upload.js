const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { resolveSafePath } = require('../middleware/pathSafety');

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
      // 同名文件处理：若存在则加序号
      const userPath = req.body.targetPath || '/';
      const resolved = resolveSafePath(userPath, config.roots);
      const destPath = resolved.valid ? resolved.absolutePath : '';

      let finalName = file.originalname;
      if (destPath) {
        let counter = 1;
        const ext = path.extname(file.originalname);
        const base = path.basename(file.originalname, ext);
        while (fs.existsSync(path.join(destPath, finalName))) {
          finalName = `${base} (${counter})${ext}`;
          counter++;
        }
      }
      cb(null, finalName);
    }
  });

  // 拦截可执行文件（防御性措施）
  const blockedExts = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll', '.sys', '.vbs', '.scr'];
  const fileFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
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

      const uploaded = req.files.map(f => ({
        name: f.filename,
        originalName: f.originalname,
        size: f.size
      }));

      res.json({
        message: `成功上传 ${uploaded.length} 个文件`,
        files: uploaded
      });
    });
  });

  return router;
}

module.exports = { createUploadRouter };
