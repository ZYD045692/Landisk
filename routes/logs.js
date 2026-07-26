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
   * DELETE /api/logs — 清空日志缓冲区 + 文件
   */
  router.delete('/', (req, res) => {
    logger.clearBuffer();
    logger.info({ message: 'cleared', type: 11, data: { op: 1 } });
    res.json({ success: true });
  });

  /**
   * DELETE /api/logs/display — 仅清空内存缓冲区，保留日志文件
   */
  router.delete('/display', (req, res) => {
    logger.clearRingBuffer();
    logger.info({ message: 'display cleared', type: 11, data: { op: 2 } });
    res.json({ success: true });
  });

  /**
   * POST /api/logs — 写入日志（供前端调用）
   * 支持结构化格式：{ level, type, data, message }
   * 也兼容旧格式：{ level, message }
   */
  router.post('/', (req, res) => {
    const body = req.body || {};
    if (body.type) {
      // 结构化格式
      const level = (body.level || 'info').toLowerCase();
      const fn = logger[level] || logger.info;
      fn({ message: body.message || '', type: body.type, data: body.data || {} });
      return res.json({ success: true });
    }
    // 旧格式向后兼容
    const { level = 'info', message } = body;
    if (!message) return res.status(400).json({ error: 'missing message' });
    const fn = logger[level] || logger.info;
    fn(message);
    res.json({ success: true });
  });

  /**
   * GET /api/logs/stream — SSE 推流，新日志实时推送
   */
  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('\n'); // 初始心跳

    const onLog = (entry) => {
      try { res.write(`data: ${JSON.stringify(entry)}\n\n`); } catch { /* 连接已断 */ }
    };
    logger.onLog(onLog);

    // 定期心跳保持连接
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
      logger.offLog(onLog);
      clearInterval(heartbeat);
    });
  });

  return router;
}

module.exports = { createLogsRouter };
