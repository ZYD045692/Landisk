const express = require('express');
const fs = require('fs');
const readline = require('readline');

// 解析一行日志: [2026-07-17 15:30:00] [INFO] 消息
const LOG_LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] \[(\w+)\] (.*)$/;

function parseLine(line) {
  const m = line.match(LOG_LINE_RE);
  if (!m) return null;
  return { timestamp: m[1], level: m[2], message: m[3] };
}

function createLogsRouter(logger) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const logPath = logger.getLogPath();
    if (!logPath) {
      return res.json([]);
    }

    const lines = Math.min(parseInt(req.query.lines) || 200, 5000);

    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n').filter(Boolean);
      const tail = allLines.slice(-lines);
      const entries = tail.map(parseLine).filter(Boolean);
      res.json(entries);
    } catch {
      res.json([]);
    }
  });

  return router;
}

module.exports = { createLogsRouter };
