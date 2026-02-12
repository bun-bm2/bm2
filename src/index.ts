#!/usr/bin/env bun
/**
 * BM2 — Bun Process Manager
 * A production-grade process manager for Bun.
 */

import { existsSync, readFileSync, unlinkSync, openSync } from "fs";
import { resolve, join, extname } from "path";
import { createConnection } from "net";
import {
  APP_NAME,
  VERSION,
  DAEMON_SOCKET,
  DAEMON_PID_FILE,
  BM2_HOME,
  DASHBOARD_PORT,
  METRICS_PORT,
} from "./constants";
import { ensureDirs, formatBytes, formatUptime, colorize, padRight } from "./utils";
import { DeployManager } from "./deploy";
import { StartupManager } from "./startup-manager";
import { EnvManager } from "./env-manager";
import type {
  StartOptions,
  EcosystemConfig,
  ProcessState,
} from "./types";

// ---------------------------------------------------------------------------
// Ensure directory structure exists
// ---------------------------------------------------------------------------
ensureDirs();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reads the last N lines from the daemon error log to help debug crashes.
 */
function getDaemonErrorLog(linesToRead = 10): string {
  const logPath = join(BM2_HOME, "daemon.err.log");
  if (!existsSync(logPath)) return "";
  try {
    const content = readFileSync(logPath, "utf-8").trim();
    if (!content) return "";
    const lines = content.split("\n");
    return lines.slice(-linesToRead).join("\n");
  } catch {
    return "";
  }
}

/**
 * Check if the daemon process is actually running by reading the PID file
 * and sending signal 0 to verify the process exists.
 */
function isDaemonRunning(): boolean {
  if (!existsSync(DAEMON_PID_FILE)) return false;
  try {
    const pid = parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim());
    if (isNaN(pid)) return false;
    process.kill(pid, 0); // signal 0 — just check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove stale socket and PID files left behind by a crashed daemon.
 */
function cleanupStaleFiles(): void {
  try {
    if (existsSync(DAEMON_SOCKET)) unlinkSync(DAEMON_SOCKET);
  } catch { /* ignore */ }
  try {
    if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE);
  } catch { /* ignore */ }
}

/**
 * Start the daemon process if it is not already running.
 * Redirects daemon stdout/stderr to ~/.bm2/daemon.{out|err}.log
 */
async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) {
    // Daemon is alive. Check for socket.
    if (existsSync(DAEMON_SOCKET)) return;

    // Socket missing but process alive — wait briefly
    for (let i = 0; i < 20; i++) {
      if (existsSync(DAEMON_SOCKET)) return;
      await Bun.sleep(100);
    }

    // Still no socket — kill stale process
    try {
      const pid = parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim());
      process.kill(pid, "SIGTERM");
    } catch { /* ignore */ }
    await Bun.sleep(500);
  }

  cleanupStaleFiles();

  const daemonScript = join(import.meta.dir, "daemon.ts");
  const bunPath = Bun.which("bun") || "bun";

  if (!existsSync(daemonScript)) {
    throw new Error(`Daemon script not found at: ${daemonScript}`);
  }

  // Prepare log files for the daemon so we can see why it crashes
  const outLog = join(BM2_HOME, "daemon.out.log");
  const errLog = join(BM2_HOME, "daemon.err.log");
  
  // Open file descriptors (append mode)
  const outFd = openSync(outLog, "a");
  const errFd = openSync(errLog, "a");

  // Spawn detached
  const child = Bun.spawn([bunPath, "run", daemonScript], {
    stdin: "ignore",
    stdout: outFd,
    stderr: errFd,
    detached: true,
  });

  child.unref();

  // Wait for socket
  const maxRetries = 50; // 5 seconds
  for (let i = 0; i < maxRetries; i++) {
    if (existsSync(DAEMON_SOCKET)) return;
    await Bun.sleep(100);
  }

  // If we timed out, read the error log to show the user
  const recentErrors = getDaemonErrorLog();
  throw new Error(
    "Daemon failed to start (socket not found).\n" +
    (recentErrors 
      ? `\n--- Daemon Stderr (last 10 lines) ---\n${recentErrors}\n-------------------------------------`
      : `Check logs at: ${errLog}`)
  );
}

/**
 * Send a JSON message to the daemon and wait for a response.
 */
async function sendToDaemon(message: object): Promise<any> {
  await startDaemon();

  return new Promise((resolve, reject) => {
    let settled = false;

    function settle(fn: typeof resolve | typeof reject, value: any) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(value);
    }

    // Timeout (10s)
    const timeout = setTimeout(() => {
      settle(reject, new Error("Daemon response timed out"));
      try { socket.destroy(); } catch { /* ignore */ }
    }, 10_000);

    const socket = createConnection(DAEMON_SOCKET, () => {
      socket.write(JSON.stringify(message) + "\n");
    });

    let data = "";

    socket.on("data", (chunk) => {
      data += chunk.toString();
      const lines = data.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          socket.end();
          settle(resolve, parsed);
          return;
        } catch {
          // Partial JSON, wait for more
        }
      }
    });

    socket.on("close", () => {
      if (!settled) {
        // Try to parse partial data
        if (data.trim()) {
          try {
            const parsed = JSON.parse(data);
            settle(resolve, parsed);
            return;
          } catch { /* ignore */ }
        }

        // Check if daemon logged an error before dying
        const recentErrors = getDaemonErrorLog(5);
        const errorDetails = recentErrors 
          ? `\n\nDaemon Error Log:\n${colorize(recentErrors, "red")}`
          : `\nCheck logs at: ${join(BM2_HOME, "daemon.err.log")}`;

        settle(
          reject,
          new Error(
            "Daemon connection closed unexpectedly. The daemon likely crashed while processing your command." + 
            errorDetails
          )
        );
      }
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ENOENT") {
        cleanupStaleFiles();
        settle(
          reject,
          new Error("Daemon is unreachable (stale socket). Please run the command again to restart it.")
        );
      } else {
        settle(reject, err);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Table Rendering & Utilities
// ---------------------------------------------------------------------------

function statusColor(status: string): string {
  switch (status) {
    case "online": return "green";
    case "stopped": return "gray";
    case "errored": return "red";
    case "launching":
    case "waiting-restart": return "yellow";
    case "stopping": return "magenta";
    default: return "white";
  }
}

function printProcessTable(processes: ProcessState[]) {
  if (!processes || processes.length === 0) {
    console.log(colorize("No processes running", "dim"));
    return;
  }

  const header = [
    padRight("id", 4),
    padRight("name", 20),
    padRight("namespace", 12),
    padRight("ver", 8),
    padRight("mode", 8),
    padRight("pid", 8),
    padRight("uptime", 10),
    padRight("↺", 4),
    padRight("status", 16),
    padRight("cpu", 8),
    padRight("mem", 10),
  ].join(" ");

  console.log(colorize(header, "dim"));
  console.log(colorize("─".repeat(header.length), "dim"));

  for (const p of processes) {
    const uptime = p.status === "online" ? formatUptime(Date.now() - p.pm2_env.pm_uptime) : "0s";
    const row = [
      padRight(String(p.pm_id), 4),
      padRight(p.name, 20),
      padRight(p.namespace || "default", 12),
      padRight(p.pm2_env.version || "N/A", 8),
      padRight(p.pm2_env.execMode, 8),
      padRight(p.pid ? String(p.pid) : "N/A", 8),
      padRight(uptime, 10),
      padRight(String(p.pm2_env.restart_time), 4),
      padRight(p.status, 16),
      padRight(p.monit.cpu.toFixed(1) + "%", 8),
      padRight(formatBytes(p.monit.memory), 10),
    ];
    console.log(row.join(" ").replace(p.status, colorize(p.status, statusColor(p.status))));
  }
}

async function loadEcosystemConfig(filePath: string): Promise<EcosystemConfig> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`Ecosystem file not found: ${abs}`);
  const ext = extname(abs);
  if (ext === ".json") return await Bun.file(abs).json();
  const mod = await import(abs);
  return mod.default || mod;
}

function parseStartFlags(args: string[], scriptOrConfig: string): StartOptions {
  const opts: StartOptions = { script: scriptOrConfig };
  let i = 0;
  const positionalArgs: string[] = [];

  while (i < args.length) {
    const arg = args[i]!;
    switch (arg) {
      case "--name": case "-n": opts.name = args[++i]; break;
      case "--instances": case "-i": opts.instances = parseInt(args[++i]!) || 1; break;
      case "--cwd": opts.cwd = args[++i]; break;
      case "--interpreter": opts.interpreter = args[++i]; break;
      case "--interpreter-args": opts.interpreterArgs = args[++i]!.split(" "); break;
      case "--node-args": opts.nodeArgs = args[++i]!.split(" "); break;
      case "--watch": case "-w": opts.watch = true; break;
      case "--watch-path": 
        if (!Array.isArray(opts.watch)) opts.watch = [];
        (opts.watch as string[]).push(args[++i]!); 
        break;
      case "--ignore-watch": opts.ignoreWatch = args[++i]!.split(","); break;
      case "--exec-mode": case "-x": opts.execMode = args[++i] as "fork" | "cluster"; break;
      case "--max-memory-restart": opts.maxMemoryRestart = args[++i]; break;
      case "--max-restarts": opts.maxRestarts = parseInt(args[++i]!); break;
      case "--min-uptime": opts.minUptime = parseInt(args[++i]!); break;
      case "--kill-timeout": opts.killTimeout = parseInt(args[++i]!); break;
      case "--restart-delay": opts.restartDelay = parseInt(args[++i]!); break;
      case "--cron": case "--cron-restart": opts.cron = args[++i]; break;
      case "--no-autorestart": opts.autorestart = false; break;
      case "--env": {
        const p = args[++i]!;
        const idx = p.indexOf("=");
        if (idx !== -1) {
          if (!opts.env) opts.env = {};
          opts.env[p.substring(0, idx)] = p.substring(idx + 1);
        }
        break;
      }
      case "--log": case "--output": case "-o": opts.outFile = args[++i]; break;
      case "--error": case "-e": opts.errorFile = args[++i]; break;
      case "--merge-logs": opts.mergeLogs = true; break;
      case "--log-date-format": opts.logDateFormat = args[++i]; break;
      case "--log-max-size": opts.logMaxSize = args[++i]; break;
      case "--log-retain": opts.logRetain = parseInt(args[++i]!); break;
      case "--log-compress": opts.logCompress = true; break;
      case "--port": case "-p": opts.port = parseInt(args[++i]!); break;
      case "--namespace": opts.namespace = args[++i]; break;
      case "--": positionalArgs.push(...args.slice(i + 1)); i = args.length; break;
      default: if (!arg.startsWith("-")) positionalArgs.push(arg); break;
    }
    i++;
  }
  if (positionalArgs.length > 0) opts.args = positionalArgs;
  return opts;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdStart(args: string[]) {
  const scriptOrConfig = args[0];
  if (!scriptOrConfig) {
    console.error(colorize("Usage: bm2 start <script|config> [options]", "red"));
    process.exit(1);
  }

  // Check if file exists before sending to daemon
  if (!existsSync(scriptOrConfig)) {
    console.error(colorize(`Error: Script or config not found: ${scriptOrConfig}`, "red"));
    process.exit(1);
  }

  const ext = extname(scriptOrConfig);
  if (ext === ".json" || scriptOrConfig.includes("ecosystem") || scriptOrConfig.includes("bm2.config")) {
    const config = await loadEcosystemConfig(scriptOrConfig);
    const res = await sendToDaemon({ type: "ecosystem", data: config });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
    return;
  }

  const opts = parseStartFlags(args.slice(1), resolve(scriptOrConfig));
  opts.script = resolve(scriptOrConfig);

  const res = await sendToDaemon({ type: "start", data: opts });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdStop(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "stopAll" : "stop";
  const res = await sendToDaemon({ type, data: target === "all" ? undefined : { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdRestart(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "restartAll" : "restart";
  const res = await sendToDaemon({ type, data: target === "all" ? undefined : { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdReload(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "reloadAll" : "reload";
  const res = await sendToDaemon({ type, data: target === "all" ? undefined : { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdDelete(args: string[]) {
  const target = args[0] || "all";
  const type = target === "all" ? "deleteAll" : "delete";
  const res = await sendToDaemon({ type, data: target === "all" ? undefined : { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Deleted", "green"));
  printProcessTable(res.data);
}

async function cmdList() {
  const res = await sendToDaemon({ type: "list" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdDescribe(args: string[]) {
  const target = args[0];
  if (!target) {
    console.error(colorize("Usage: bm2 describe <id|name>", "red"));
    process.exit(1);
  }
  const res = await sendToDaemon({ type: "describe", data: { target } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  const processes: ProcessState[] = res.data;
  for (const p of processes) {
    console.log(colorize(`\n─── ${p.name} (id: ${p.pm_id}) ───`, "bold"));
    console.log(`  Status       : ${colorize(p.status, statusColor(p.status))}`);
    console.log(`  Script       : ${p.pm2_env.script}`);
    console.log(`  Log (out)    : ${p.pm2_env.pm_out_log_path}`);
    console.log(`  Log (err)    : ${p.pm2_env.pm_err_log_path}`);
    console.log(`  Restarts     : ${p.pm2_env.restart_time}`);
    console.log(`  Memory       : ${formatBytes(p.monit.memory)}`);
    console.log(`  CPU          : ${p.monit.cpu.toFixed(1)}%`);
  }
}

async function cmdLogs(args: string[]) {
  const target = args[0] || "all";
  let lines = 20;
  const linesIdx = args.indexOf("--lines");
  if (linesIdx !== -1 && args[linesIdx + 1]) lines = parseInt(args[linesIdx + 1]!);
  
  const res = await sendToDaemon({ type: "logs", data: { target, lines } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  for (const log of res.data) {
    console.log(colorize(`\n─── ${log.name} (id: ${log.id}) ───`, "bold"));
    if (log.out) console.log(log.out);
    if (log.err) console.log(colorize(log.err, "red"));
  }
}

async function cmdFlush(args: string[]) {
  const target = args[0];
  const res = await sendToDaemon({ type: "flush", data: target ? { target } : undefined });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Logs flushed", "green"));
}

async function cmdScale(args: string[]) {
  const target = args[0];
  const count = parseInt(args[1]!);
  if (!target || isNaN(count)) {
    console.error(colorize("Usage: bm2 scale <name|id> <count>", "red"));
    process.exit(1);
  }
  const res = await sendToDaemon({ type: "scale", data: { target, count } });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdSave() {
  const res = await sendToDaemon({ type: "save" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  console.log(colorize("✓ Process list saved", "green"));
}

async function cmdResurrect() {
  const res = await sendToDaemon({ type: "resurrect" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  printProcessTable(res.data);
}

async function cmdKill() {
  try {
    await sendToDaemon({ type: "kill" });
  } catch { /* ignore */ }
  await Bun.sleep(500);
  cleanupStaleFiles();
  console.log(colorize("✓ Daemon killed", "green"));
}

async function cmdMonit() {
  const res = await sendToDaemon({ type: "metrics" });
  if (!res.success) {
    console.error(colorize(`Error: ${res.error}`, "red"));
    process.exit(1);
  }
  const snapshot = res.data;
  console.log(colorize("\n⚡ BM2 Monitor\n", "bold"));
  console.log(`System: CPU ${snapshot.system.cpuCount} cores | Load ${snapshot.system.loadAvg[0]?.toFixed(2)}`);
  for (const p of snapshot.processes) {
    console.log(`${padRight(p.name, 20)} ${colorize(p.status, statusColor(p.status))} CPU: ${p.cpu.toFixed(1)}% Mem: ${formatBytes(p.memory)}`);
  }
}

// ---------------------------------------------------------------------------
// Main Dispatch
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];
const commandArgs = args.slice(1);

switch (command) {
  case "start": await cmdStart(commandArgs); break;
  case "stop": await cmdStop(commandArgs); break;
  case "restart": await cmdRestart(commandArgs); break;
  case "reload": await cmdReload(commandArgs); break;
  case "delete": case "rm": await cmdDelete(commandArgs); break;
  case "scale": await cmdScale(commandArgs); break;
  case "list": case "ls": await cmdList(); break;
  case "describe": await cmdDescribe(commandArgs); break;
  case "logs": await cmdLogs(commandArgs); break;
  case "flush": await cmdFlush(commandArgs); break;
  case "monit": await cmdMonit(); break;
  case "save": await cmdSave(); break;
  case "resurrect": await cmdResurrect(); break;
  case "kill": await cmdKill(); break;
  case "help":
  case undefined:
    console.log(`BM2 v${VERSION} - Usage: bm2 <command> [options]`);
    break;
  default:
    console.error(colorize(`Unknown command: ${command}`, "red"));
    process.exit(1);
}
