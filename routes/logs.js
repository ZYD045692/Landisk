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
    logger.info('[日志] 已清空');
    res.json({ success: true });
  });

  return router;
}

module.exports = { createLogsRouter };
