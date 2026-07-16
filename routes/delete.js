const express = require('express');
const fs = require('fs/promises');
const { resolveSafePath } = require('../middleware/pathSafety');

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
      if (stat.isDirectory()) {
        await fs.rm(resolved.absolutePath, { recursive: true });
      } else {
        await fs.unlink(resolved.absolutePath);
      }
      res.json({ message: 'Deleted successfully' });
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
      if (err.code === 'EACCES' || err.code === 'EPERM') return res.status(403).json({ error: 'Permission denied' });
      res.status(500).json({ error: 'Delete failed' });
    }
  });

  return router;
}

module.exports = { createDeleteRouter };
