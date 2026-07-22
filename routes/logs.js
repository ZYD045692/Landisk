const express = require('express');

function createLogsRouter(logger) {
  const router = express.Router();

  /**
   * GET /api/logs?lines=200&level=INFO&search=xxx
   * 从内存环形缓冲区读取，零文件 I/O
   */
  router.get('/', (req, res) => {
    const lines = Math.min(parseInt(req.query.lines) || 200, 5000);
    const options = {};

    if (req.query.level) {
      options.level = req.query.level;
    }
    if (req.query.search) {
      options.search = req.query.search;
    }

    try {
      const entries = logger.getBuffer(lines, options);
      res.json(entries);
    } catch {
      res.json([]);
    }
  });

  /**
   * DELETE /api/logs — 清空日志缓冲区
   */
  router.delete('/', (req, res) => {
    logger.clearBuffer();
    logger.info({ message: 'cleared', type: 11, data: { op: 1 } });
    res.json({ success: true });
  });

  /**
   * POST /api/logs — 写入日志（供前端调用）
   */
  router.post('/', (req, res) => {
    const { level = 'info', message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'missing message' });
    const fn = logger[level] || logger.info;
    fn(message);
    res.json({ success: true });
  });

  return router;
}

module.exports = { createLogsRouter };
