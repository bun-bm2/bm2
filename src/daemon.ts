/**
 * BM2 — Bun Process Manager
 * A production-grade process manager for Bun.
 *
 * Features:
 * - Fork & cluster execution modes
 * - Auto-restart & crash recovery
 * - Health checks & monitoring
 * - Log management & rotation
 * - Deployment support
 *
 * https://github.com/your-org/bm2
 * License: GPL-3.0-only
 * Author: Zak <zak@maxxpainn.com>
 */
 
import { ProcessManager } from "./process-manager";
import { Dashboard } from "./dashboard";
import { ModuleManager } from "./module-manager";
import {
  DAEMON_SOCKET,
  DAEMON_PID_FILE,
  DASHBOARD_PORT,
  METRICS_PORT,
} from "./constants";
import { ensureDirs } from "./utils";
import { unlinkSync, existsSync } from "fs";
import type { DaemonMessage, DaemonResponse } from "./types";
import type { ServerWebSocket } from "bun";

ensureDirs();

const pm = new ProcessManager();
const dashboard = new Dashboard(pm);
const moduleManager = new ModuleManager(pm);

// Clean up existing socket
if (existsSync(DAEMON_SOCKET)) {
  try { unlinkSync(DAEMON_SOCKET); } catch {}
}

// Write PID file
await Bun.write(DAEMON_PID_FILE, String(process.pid));

// Load modules
await moduleManager.loadAll();

// Start metric collection
const metricsInterval = setInterval(() => {
  pm.getMetrics();
}, 2000);

async function handleMessage(msg: DaemonMessage): Promise<DaemonResponse> {
  try {
    switch (msg.type) {
      case "start": {
        const states = await pm.start(msg.data);
        return { type: "start", data: states, success: true, id: msg.id };
      }
      case "stop": {
        const states = await pm.stop(msg.data.target);
        return { type: "stop", data: states, success: true, id: msg.id };
      }
      case "restart": {
        const states = await pm.restart(msg.data.target);
        return { type: "restart", data: states, success: true, id: msg.id };
      }
      case "reload": {
        const states = await pm.reload(msg.data.target);
        return { type: "reload", data: states, success: true, id: msg.id };
      }
      case "delete": {
        const states = await pm.del(msg.data.target);
        return { type: "delete", data: states, success: true, id: msg.id };
      }
      case "scale": {
        const states = await pm.scale(msg.data.target, msg.data.count);
        return { type: "scale", data: states, success: true, id: msg.id };
      }
      case "stopAll": {
        const states = await pm.stopAll();
        return { type: "stopAll", data: states, success: true, id: msg.id };
      }
      case "restartAll": {
        const states = await pm.restartAll();
        return { type: "restartAll", data: states, success: true, id: msg.id };
      }
      case "reloadAll": {
        const states = await pm.reloadAll();
        return { type: "reloadAll", data: states, success: true, id: msg.id };
      }
      case "deleteAll": {
        const states = await pm.deleteAll();
        return { type: "deleteAll", data: states, success: true, id: msg.id };
      }
      case "list": {
        return { type: "list", data: pm.list(), success: true, id: msg.id };
      }
      case "describe": {
        return { type: "describe", data: pm.describe(msg.data.target), success: true, id: msg.id };
      }
      case "logs": {
        const logs = await pm.getLogs(msg.data.target, msg.data.lines);
        return { type: "logs", data: logs, success: true, id: msg.id };
      }
      case "flush": {
        await pm.flushLogs(msg.data?.target);
        return { type: "flush", success: true, id: msg.id };
      }
      case "save": {
        await pm.save();
        return { type: "save", success: true, id: msg.id };
      }
      case "resurrect": {
        const states = await pm.resurrect();
        return { type: "resurrect", data: states, success: true, id: msg.id };
      }
      case "ecosystem": {
        const states = await pm.startEcosystem(msg.data);
        return { type: "ecosystem", data: states, success: true, id: msg.id };
      }
      case "signal": {
        await pm.sendSignal(msg.data.target, msg.data.signal);
        return { type: "signal", success: true, id: msg.id };
      }
      case "reset": {
        const states = await pm.reset(msg.data.target);
        return { type: "reset", data: states, success: true, id: msg.id };
      }
      case "metrics": {
        const metrics = await pm.getMetrics();
        return { type: "metrics", data: metrics, success: true, id: msg.id };
      }
      case "metricsHistory": {
        const history = pm.getMetricsHistory(msg.data?.seconds || 300);
        return { type: "metricsHistory", data: history, success: true, id: msg.id };
      }
      case "prometheus": {
        const prom = pm.getPrometheusMetrics();
        return { type: "prometheus", data: prom, success: true, id: msg.id };
      }
      case "dashboard": {
        const port = msg.data?.port || DASHBOARD_PORT;
        const metricsPort = msg.data?.metricsPort || METRICS_PORT;
        dashboard.start(port, metricsPort);
        return { type: "dashboard", data: { port, metricsPort }, success: true, id: msg.id };
      }
      case "dashboardStop": {
        dashboard.stop();
        return { type: "dashboardStop", success: true, id: msg.id };
      }
      case "moduleInstall": {
        const path = await moduleManager.install(msg.data.module);
        return { type: "moduleInstall", data: { path }, success: true, id: msg.id };
      }
      case "moduleUninstall": {
        await moduleManager.uninstall(msg.data.module);
        return { type: "moduleUninstall", success: true, id: msg.id };
      }
      case "moduleList": {
        return { type: "moduleList", data: moduleManager.list(), success: true, id: msg.id };
      }
      case "ping": {
        return {
          type: "pong",
          data: { pid: process.pid, uptime: process.uptime() },
          success: true,
          id: msg.id,
        };
      }
      case "kill": {
        await pm.stopAll();
        dashboard.stop();
        clearInterval(metricsInterval);
        setTimeout(() => process.exit(0), 200);
        return { type: "kill", success: true, id: msg.id };
      }
      default:
        return { type: "error", error: `Unknown command: ${msg.type}`, success: false, id: msg.id };
    }
  } catch (err: any) {
    return { type: "error", error: err.message, success: false, id: msg.id };
  }
}

// Unix socket server
const server = Bun.serve({
  unix: DAEMON_SOCKET,
  fetch(req, server) {
    if (server.upgrade(req)) return;
    return new Response("bm2 daemon");
  },
  websocket: {
    async message(ws: ServerWebSocket<unknown>, message) {
      try {
        const msg: DaemonMessage = JSON.parse(String(message));
        const response = await handleMessage(msg);
        ws.send(JSON.stringify(response));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "error", error: err.message, success: false }));
      }
    },
    open(ws) {},
    close(ws) {},
  },
});

// Signal handlers
const shutdown = async () => {
  console.log("\n[bm2] Shutting down daemon...");
  await pm.stopAll();
  dashboard.stop();
  clearInterval(metricsInterval);
  try { unlinkSync(DAEMON_SOCKET); } catch {}
  try { unlinkSync(DAEMON_PID_FILE); } catch {}
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

// Handle uncaught errors to keep daemon alive
process.on("uncaughtException", (err) => {
  console.error("[bm2] Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[bm2] Unhandled rejection:", err);
});

console.log(`[bm2] Daemon running (PID: ${process.pid})`);
console.log(`[bm2] Socket: ${DAEMON_SOCKET}`);
