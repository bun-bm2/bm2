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
 
import { mkdirSync, existsSync } from "fs";
import { ALL_DIRS } from "./constants";

export function ensureDirs() {
  for (const dir of ALL_DIRS) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export function parseMemory(value: string | number): number {
  if (typeof value === "number") return value;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*(K|M|G|T)?B?$/i);
  if (!match) throw new Error(`Invalid memory value: ${value}`);
  const num = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();
  const multipliers: Record<string, number> = {
    "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4,
  };
  return num * (multipliers[unit] || 1);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").substring(0, 12);
}

export function colorize(text: string, color: string): string {
  const colors: Record<string, string> = {
    red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
    blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m",
    white: "\x1b[37m", gray: "\x1b[90m", bold: "\x1b[1m",
    dim: "\x1b[2m", reset: "\x1b[0m",
  };
  return `${colors[color] || ""}${text}\x1b[0m`;
}

export function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + " ".repeat(len - str.length);
}

export function getCpuCount(): number {
  const cpus = require("os").cpus();
  return cpus.length;
}

export function getSystemInfo() {
  const os = require("os");
  return {
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpuCount: os.cpus().length,
    loadAvg: os.loadavg(),
    platform: os.platform(),
    hostname: os.hostname(),
    uptime: os.uptime(),
  };
}

export function treeKill(pid: number, signal: string = "SIGTERM"): Promise<void> {
  return new Promise(async (resolve) => {
    try {
      if (process.platform === "linux") {
        // Get all child pids from /proc
        const result = Bun.spawn(["pgrep", "-P", String(pid)], { stdout: "pipe" });
        const output = await new Response(result.stdout).text();
        const childPids = output.trim().split("\n").filter(Boolean).map(Number);

        for (const childPid of childPids) {
          await treeKill(childPid, signal);
        }
      } else {
        // macOS
        const result = Bun.spawn(["pgrep", "-P", String(pid)], { stdout: "pipe" });
        const output = await new Response(result.stdout).text();
        const childPids = output.trim().split("\n").filter(Boolean).map(Number);

        for (const childPid of childPids) {
          await treeKill(childPid, signal);
        }
      }

      try {
        process.kill(pid, signal as any);
      } catch {}
    } catch {}
    resolve();
  });
}

export function parseCron(expression: string): { next: () => Date } {
  // Simple cron parser supporting: minute hour dayOfMonth month dayOfWeek
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron: ${expression}`);

  const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

  function matchField(value: number, expr: string, max: number): boolean {
    if (expr === "*") return true;

    for (const part of expr.split(",")) {
      if (part.includes("/")) {
        const [range, step] = part.split("/");
        const stepNum = parseInt(step);
        const start = range === "*" ? 0 : parseInt(range);
        if ((value - start) % stepNum === 0 && value >= start) return true;
      } else if (part.includes("-")) {
        const [lo, hi] = part.split("-").map(Number);
        if (value >= lo && value <= hi) return true;
      } else {
        if (value === parseInt(part)) return true;
      }
    }
    return false;
  }

  return {
    next(): Date {
      const now = new Date();
      const candidate = new Date(now);
      candidate.setSeconds(0, 0);
      candidate.setMinutes(candidate.getMinutes() + 1);

      for (let i = 0; i < 525600; i++) { // max 1 year search
        const min = candidate.getMinutes();
        const hour = candidate.getHours();
        const dom = candidate.getDate();
        const mon = candidate.getMonth() + 1;
        const dow = candidate.getDay();

        if (
          matchField(min, minExpr, 59) &&
          matchField(hour, hourExpr, 23) &&
          matchField(dom, domExpr, 31) &&
          matchField(mon, monExpr, 12) &&
          matchField(dow, dowExpr, 6)
        ) {
          return candidate;
        }

        candidate.setMinutes(candidate.getMinutes() + 1);
      }

      throw new Error("Could not find next cron time");
    },
  };
}
