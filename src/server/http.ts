/**
 * HTTP + WebSocket 服务器
 *
 * 提供:
 *   1. REST API — 控制硬件、查询统计
 *   2. WebSocket — 实时推送状态和事件
 *   3. 仪表盘页面 — 可视化监控
 */

import express from 'express';
import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'path';
import * as fs from 'fs';
import { AICrackerOrchestrator, SessionStats, SeedProcessResult } from '../ai/orchestrator';
import { CrackerState } from '../ai/state-machine';
import logger from '../utils/logger';

export class CrackerServer {
  private app = express();
  private server: http.Server;
  private wss: WebSocketServer;
  private orchestrator: AICrackerOrchestrator;
  private clients: Set<WebSocket> = new Set();
  private port: number;

  constructor(orchestrator: AICrackerOrchestrator, port: number = 3000) {
    this.orchestrator = orchestrator;
    this.port = port;
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.bindOrchestratorEvents();
  }

  /**
   * 启动服务器
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info(`Dashboard server running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.close();
      this.server.close(() => resolve());
    });
  }

  private setupMiddleware(): void {
    this.app.use(express.json());

    // CORS
    this.app.use((_req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });

    // 仪表盘静态资源
    const dashboardPath = path.join(__dirname, 'dashboard.html');
    this.app.get('/', (_req, res) => {
      if (fs.existsSync(dashboardPath)) {
        res.sendFile(dashboardPath);
      } else {
        res.type('html').send(this.getInlineDashboard());
      }
    });
  }

  private setupRoutes(): void {
    // ──── 控制 API ────

    /** 开始批量处理 */
    this.app.post('/api/start', async (_req, res) => {
      try {
        const count = _req.body.count as number | undefined;
        // 异步启动批量处理
        this.orchestrator.processBatch(count).catch((err) => {
          logger.error('Batch processing error:', err);
        });
        res.json({ status: 'started', count: count ?? 'continuous' });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    /** 单颗处理 */
    this.app.post('/api/seed', async (_req, res) => {
      try {
        const result = await this.orchestrator.processSeed();
        res.json(result);
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    /** 停止 */
    this.app.post('/api/stop', async (_req, res) => {
      await this.orchestrator.stop();
      res.json({ status: 'stopped' });
    });

    /** 暂停 */
    this.app.post('/api/pause', (_req, res) => {
      this.orchestrator.pause();
      res.json({ status: 'paused' });
    });

    /** 恢复 */
    this.app.post('/api/resume', (_req, res) => {
      this.orchestrator.resume();
      res.json({ status: 'resumed' });
    });

    /** 获取状态 */
    this.app.get('/api/status', (_req, res) => {
      res.json({
        stats: this.orchestrator.getStats(),
        state: CrackerState.IDLE,
        timestamp: Date.now(),
      });
    });

    /** 获取统计 */
    this.app.get('/api/stats', (_req, res) => {
      res.json(this.orchestrator.getStats());
    });

    /** 重置统计 */
    this.app.post('/api/reset', (_req, res) => {
      this.orchestrator.resetStats();
      res.json({ status: 'reset' });
    });

    /** 健康检查 */
    this.app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      logger.debug(`WebSocket client connected (total: ${this.clients.size})`);

      // 发送当前状态
      ws.send(JSON.stringify({
        type: 'status',
        data: {
          stats: this.orchestrator.getStats(),
          timestamp: Date.now(),
        },
      }));

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.debug(`WebSocket client disconnected (total: ${this.clients.size})`);
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleWebSocketCommand(ws, msg);
        } catch {
          // 忽略无效消息
        }
      });
    });
  }

  private handleWebSocketCommand(ws: WebSocket, msg: any): void {
    switch (msg.action) {
      case 'start':
        this.orchestrator.processBatch(msg.count).catch(logger.error);
        break;
      case 'stop':
        this.orchestrator.stop();
        break;
      case 'pause':
        this.orchestrator.pause();
        break;
      case 'resume':
        this.orchestrator.resume();
        break;
      case 'seed':
        this.orchestrator.processSeed().then((result) => {
          ws.send(JSON.stringify({ type: 'seed_result', data: result }));
        });
        break;
    }
  }

  private bindOrchestratorEvents(): void {
    this.orchestrator.on('seed', (result: SeedProcessResult) => {
      this.broadcast({ type: 'seed', data: result });
    });

    this.orchestrator.on('stats', (stats: SessionStats) => {
      this.broadcast({ type: 'stats', data: stats });
    });

    this.orchestrator.on('state', (state: CrackerState) => {
      this.broadcast({ type: 'state', data: { state } });
    });
  }

  private broadcast(message: any): void {
    const data = JSON.stringify(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  /**
   * 内联网页仪表盘
   */
  private getInlineDashboard(): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>嗑瓜子神器 · AI 控制台</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a;
      color: #f1f5f9;
      padding: 24px;
      min-height: 100vh;
    }
    h1 {
      font-size: 28px;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #fbbf24, #f97316);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { color: #94a3b8; margin-bottom: 32px; font-size: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
    }
    .card-title { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .card-value { font-size: 36px; font-weight: 700; }
    .card-value.success { color: #22c55e; }
    .card-value.fail { color: #ef4444; }
    .card-value.warn { color: #f59e0b; }
    .card-value.info { color: #3b82f6; }
    .btn-group { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    button {
      padding: 10px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-start { background: #22c55e; color: #fff; }
    .btn-start:hover:not(:disabled) { background: #16a34a; }
    .btn-stop { background: #ef4444; color: #fff; }
    .btn-stop:hover:not(:disabled) { background: #dc2626; }
    .btn-pause { background: #f59e0b; color: #fff; }
    .btn-reset { background: #64748b; color: #fff; }
    .btn-seed { background: #3b82f6; color: #fff; }
    .log-area {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 16px;
      height: 300px;
      overflow-y: auto;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 13px;
      line-height: 1.6;
    }
    .log-entry { padding: 2px 0; border-bottom: 1px solid #1e293b; }
    .log-entry.ok { color: #22c55e; }
    .log-entry.fail { color: #ef4444; }
    .log-entry.info { color: #94a3b8; }
    .state-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin-left: 12px;
    }
    .state-idle { background: #334155; color: #94a3b8; }
    .state-running { background: #14532d; color: #22c55e; }
    .state-error { background: #450a0a; color: #ef4444; }
    .progress-bar {
      width: 100%;
      height: 8px;
      background: #334155;
      border-radius: 4px;
      margin-top: 8px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #22c55e, #fbbf24);
      border-radius: 4px;
      transition: width 0.3s;
    }
  </style>
</head>
<body>
  <h1>🌻 嗑瓜子神器 <span class="state-badge state-idle" id="stateBadge">IDLE</span></h1>
  <p class="subtitle">AI 驱动程序 · 实时监控控制台</p>

  <div class="grid">
    <div class="card">
      <div class="card-title">📊 已处理</div>
      <div class="card-value info" id="totalProcessed">0</div>
    </div>
    <div class="card">
      <div class="card-title">✅ 成功</div>
      <div class="card-value success" id="successful">0</div>
    </div>
    <div class="card">
      <div class="card-title">❌ 失败</div>
      <div class="card-value fail" id="failed">0</div>
    </div>
    <div class="card">
      <div class="card-title">🚫 拒收</div>
      <div class="card-value warn" id="rejected">0</div>
    </div>
    <div class="card">
      <div class="card-title">📈 成功率</div>
      <div class="card-value success" id="successRate">0%</div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
    </div>
    <div class="card">
      <div class="card-title">⏱ 平均耗时</div>
      <div class="card-value info" id="avgTime">0ms</div>
    </div>
  </div>

  <div class="btn-group">
    <button class="btn-start" id="btnStart" onclick="sendCmd('start')">▶ 开始批量</button>
    <button class="btn-seed" id="btnSeed" onclick="sendCmd('seed')">🌱 单颗处理</button>
    <button class="btn-pause" id="btnPause" onclick="sendCmd('pause')">⏸ 暂停</button>
    <button class="btn-stop" id="btnStop" onclick="sendCmd('stop')">⏹ 停止</button>
    <button class="btn-reset" onclick="resetStats()">🔄 重置统计</button>
  </div>

  <div class="card">
    <div class="card-title">📋 实时日志</div>
    <div class="log-area" id="logArea">
      <div class="log-entry info">🟢 系统就绪，等待指令...</div>
    </div>
  </div>

  <script>
    const ws = new WebSocket('ws://' + location.host);
    const logArea = document.getElementById('logArea');
    const stateBadge = document.getElementById('stateBadge');

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'stats':
          updateStats(msg.data);
          break;
        case 'seed':
          addLog(msg.data);
          break;
        case 'state':
          updateState(msg.data.state);
          break;
        case 'seed_result':
          addLog(msg.data);
          break;
      }
    };

    function updateStats(s) {
      document.getElementById('totalProcessed').textContent = s.totalProcessed;
      document.getElementById('successful').textContent = s.successful;
      document.getElementById('failed').textContent = s.failed;
      document.getElementById('rejected').textContent = s.rejected;
      const rate = s.totalProcessed > 0 ? (s.successRate * 100).toFixed(1) + '%' : '0%';
      document.getElementById('successRate').textContent = rate;
      document.getElementById('progressFill').style.width = rate;
      document.getElementById('avgTime').textContent = s.averageTimeMs + 'ms';
      updateState(s.currentState);
    }

    function updateState(state) {
      stateBadge.textContent = state;
      stateBadge.className = 'state-badge ' + (
        state === 'IDLE' ? 'state-idle' :
        state === 'ERROR' ? 'state-error' : 'state-running'
      );
    }

    function addLog(result) {
      const div = document.createElement('div');
      const icon = result.success ? '✅' : '❌';
      const cls = result.success ? 'ok' : (result.error ? 'fail' : 'info');
      div.className = 'log-entry ' + cls;
      div.textContent = icon + ' #' + result.seedId + ' ' +
        (result.orientation || '?') + ' | ' +
        (result.success ? '成功' : (result.error || '失败')) +
        ' | ' + result.durationMs + 'ms';
      logArea.appendChild(div);
      logArea.scrollTop = logArea.scrollHeight;
    }

    function sendCmd(action) {
      ws.send(JSON.stringify({ action }));
    }

    function resetStats() {
      fetch('/api/reset', { method: 'POST' });
    }
  </script>
</body>
</html>`;
  }
}
