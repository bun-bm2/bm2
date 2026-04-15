#!/usr/bin/env bun
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

import { existsSync, readFileSync, unlinkSync } from "fs";
import path, { resolve, join, extname } from "path";
import {
  APP_NAME,
  VERSION,
  DAEMON_SOCKET,
  DAEMON_PID_FILE,
  BM2_HOME,
  DASHBOARD_PORT,
  METRICS_PORT,
  DAEMON_OUT_LOG_FILE,
  DAEMON_ERR_LOG_FILE,
} from "./constants";
import { ensureDirs, formatBytes, formatUptime, colorize, padRight } from "./utils";
import { DeployManager } from "./deploy";
import { StartupManager } from "./startup-manager";
import { EnvManager } from "./env-manager";
import type {
  DaemonMessage,
  DaemonResponse,
  StartOptions,
  EcosystemConfig,
  ProcessState,
} from "./types";
import { statusColor } from "./colors";
import { liveWatchProcess, printProcessTable } from "./process-table";
import Daemon from "./daemon";

// ---------------------------------------------------------------------------
// Ensure directory structure exists
// ---------------------------------------------------------------------------
await ensureDirs();

// ---------------------------------------------------------------------------
// BM2CLI class
// ---------------------------------------------------------------------------

class BM2CLI {
  
  noDaemon = false;

  // -------------------------------------------------------------------------
  // Daemon helpers
  // -------------------------------------------------------------------------

  isDaemonRunning(): boolean {
    if (!existsSync(DAEMON_PID_FILE)) return false;
    try {
      const pid = parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim());
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  async startDaemon(): Promise<void> {
    
    if (this.isDaemonRunning()) return;

    const daemonScript = join(import.meta.dir, "daemon.ts");
    const bunPath = Bun.which("bun") || "bun";

    const stdout = Bun.file(DAEMON_OUT_LOG_FILE);
    const stderr = Bun.file(DAEMON_ERR_LOG_FILE);

    if (!(await stdout.exists())) await Bun.write(stdout, "");
    if (!(await stderr.exists())) await Bun.write(stderr, "");

    const child = Bun.spawn([bunPath, "run", daemonScript], {
      stdout,
      stderr,
      stdin: "ignore",
    });

    child.unref();

    console.error(colorize("Starting daemon..", "green"));

    for (let i = 0; i < 100; i++) {
      if (this.isDaemonRunning()) return;
      await Bun.sleep(1_000);
      console.error(colorize("Waiting for daemon..", "cyan"));
    }

    if (!this.isDaemonRunning()) {
      throw new Error("Daemon failed to start (socket not found after 5 s)");
    }
  }

  async stopDaemon(): Promise<void> {
    try {
      if (!this.isDaemonRunning()) return;

      const pidText = await Bun.file(DAEMON_PID_FILE).text();
      const pid = Number(pidText);

      process.kill(pid, "SIGTERM");
      console.error("Daemon stopped");

      await Bun.write(DAEMON_PID_FILE, "");
    } catch (err) {
      console.error("Failed to stop daemon:", err);
    }
  }

  async sendToDaemon(msg: DaemonMessage): Promise<DaemonResponse> {
    
    
    if (this.noDaemon) {
      return this.callDaemonCmd(msg)
    }
    
    await this.startDaemon();

    let res;

    try {
      res = await fetch("http://localhost/command", {
        unix: DAEMON_SOCKET,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      });

      if (!res.ok) {
        throw new Error(`Daemon error: ${res.status}`);
      }

      return (await res.json()) as DaemonResponse;
    } catch (e: any) {
      console.log("Results returned: " + (await res?.text()));
      console.log();
      console.log("sendToDaemon#Error:", e, e.stack);
      return { type: "error", error: "Fetch Error", success: false };
    }
  }

  async callDaemonCmd(msg: DaemonMessage): Promise<DaemonResponse> {
    try {
      const d = new Daemon();
      await d.initialize();
      return d.handleMessage(msg);
    } catch (e: any) {
      console.log("callDaemonCmd:", e, e.stack);
      return { type: "error", error: "Fetch Error", success: false };
    }
  }

  // -------------------------------------------------------------------------
  // Ecosystem config loader
  // -------------------------------------------------------------------------

  async loadEcosystemConfig(filePath: string): Promise<EcosystemConfig> {
    
    const abs = resolve(filePath);
    const file = Bun.file(abs);

    if (!(await file.exists())) {
      throw new Error(`Ecosystem file not found: ${abs}`);
    }

    const ext = extname(abs);
    let config: EcosystemConfig;

    if (ext === ".json") {
      config = (await file.json()) as EcosystemConfig;
    } else {
      const mod = await import(abs);
      config = (mod.default || mod) as EcosystemConfig;
    }

    const cwd = path.dirname(abs);
    
    if (config.noDaemon) {
      this.noDaemon = config.noDaemon;
    }

    config.apps = config.apps.map((i) => {
      if ((i.cwd || "").trim() === "") {
        i.cwd = cwd;
      }
      return i;
    });

    return config;
  }

  // -------------------------------------------------------------------------
  // CLI flag parser
  //
  // Flags may appear in ANY order relative to the script path, e.g.:
  //   bm2 start app.ts --no-daemon --name api
  //   bm2 start --no-daemon app.ts --name api
  //   bm2 start --name api --no-daemon app.ts
  //
  // The first non-flag token encountered is treated as the script path.
  // Every subsequent non-flag token (or tokens after --) becomes an arg.
  // -------------------------------------------------------------------------

  parseStartFlags(args: string[]): StartOptions {
    
    const opts: StartOptions = { script: "" };

    let i = 0;
    let scriptResolved = false;
    const positionalArgs: string[] = [];

    while (i < args.length) {
      const arg = args[i]!;

      // End-of-flags sentinel — everything after is passed to the script
      if (arg === "--") {
        positionalArgs.push(...args.slice(i + 1));
        break;
      }

      switch (arg) {
        case "--name":
        case "-n":
          opts.name = args[++i];
          break;
        case "--instances":
        case "-i":
          opts.instances = parseInt(args[++i]!) || 1;
          break;
        case "--cwd":
          opts.cwd = args[++i];
          break;
        case "--interpreter":
          opts.interpreter = args[++i];
          break;
        case "--interpreter-args":
          opts.interpreterArgs = args[++i]!.split(" ");
          break;
        case "--node-args":
          opts.nodeArgs = args[++i]!.split(" ");
          break;
        case "--watch":
        case "-w":
          opts.watch = true;
          break;
        case "--watch-path":
          if (!Array.isArray(opts.watch)) opts.watch = [];
          (opts.watch as string[]).push(args[++i]!);
          break;
        case "--ignore-watch":
          opts.ignoreWatch = args[++i]!.split(",");
          break;
        case "--exec-mode":
        case "-x":
          opts.execMode = args[++i] as "fork" | "cluster";
          break;
        case "--max-memory-restart":
          opts.maxMemoryRestart = args[++i];
          break;
        case "--max-restarts":
          opts.maxRestarts = parseInt(args[++i]!);
          break;
        case "--min-uptime":
          opts.minUptime = parseInt(args[++i]!);
          break;
        case "--kill-timeout":
          opts.killTimeout = parseInt(args[++i]!);
          break;
        case "--restart-delay":
          opts.restartDelay = parseInt(args[++i]!);
          break;
        case "--cron":
        case "--cron-restart":
          opts.cron = args[++i];
          break;
        case "--no-autorestart":
          opts.autorestart = false;
          break;
        case "--env": {
          const envPair = args[++i]!;
          const eqIdx = envPair.indexOf("=");
          if (eqIdx !== -1) {
            if (!opts.env) opts.env = {};
            opts.env[envPair.substring(0, eqIdx)] = envPair.substring(eqIdx + 1);
          }
          break;
        }
        case "--log":
        case "--output":
        case "-o":
          opts.outFile = args[++i];
          break;
        case "--error":
        case "-e":
          opts.errorFile = args[++i];
          break;
        case "--merge-logs":
          opts.mergeLogs = true;
          break;
        case "--log-date-format":
          opts.logDateFormat = args[++i];
          break;
        case "--log-max-size":
          opts.logMaxSize = args[++i];
          break;
        case "--log-retain":
          opts.logRetain = parseInt(args[++i]!);
          break;
        case "--log-compress":
          opts.logCompress = true;
          break;
        case "--port":
        case "-p":
          opts.port = parseInt(args[++i]!);
          break;
        case "--health-check-url":
          opts.healthCheckUrl = args[++i];
          break;
        case "--health-check-interval":
          opts.healthCheckInterval = parseInt(args[++i]!);
          break;
        case "--health-check-timeout":
          opts.healthCheckTimeout = parseInt(args[++i]!);
          break;
        case "--health-check-max-fails":
          opts.healthCheckMaxFails = parseInt(args[++i]!);
          break;
        case "--wait-ready":
          opts.waitReady = true;
          break;
        case "--listen-timeout":
          opts.listenTimeout = parseInt(args[++i]!);
          break;
        case "--namespace":
          opts.namespace = args[++i];
          break;
        case "--source-map-support":
          opts.sourceMapSupport = true;
          break;
        default:
          if (arg.startsWith("-")) {
            // Unknown flag — warn and skip
            console.warn(colorize(`[bm2] Unknown flag ignored: ${arg}`, "dim"));
          } else {
            // Positional token: first one is the script, rest are script args
            if (!scriptResolved) {
              opts.script = arg;
              scriptResolved = true;
            } else {
              positionalArgs.push(arg);
            }
          }
          break;
      }

      i++;
    }

    if (positionalArgs.length > 0) opts.args = positionalArgs;

    return opts;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async cmdStart(args: string[]) {
    
    if (args.length === 0) {
      console.error(colorize("Usage: bm2 start <script|config> [options]", "red"));
      process.exit(1);
    }

    // Peek at the first non-flag argument to decide if it's an ecosystem file.
    // We do this before full parsing so we can branch early without consuming args.
    const firstPositional = args.find((a) => !a.startsWith("-"));

    if (!firstPositional) {
      console.error(colorize("Usage: bm2 start <script|config> [options]", "red"));
      process.exit(1);
    }

    const ext = extname(firstPositional);

    if (
      ext === ".json" ||
      firstPositional.includes("ecosystem") ||
      firstPositional.includes("bm2.config") ||
      firstPositional.includes("pm2.config")
    ) {
      
      const config = await this.loadEcosystemConfig(firstPositional);
      const res = await this.sendToDaemon({ type: "ecosystem", data: config });
      
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
      
      printProcessTable(res.data);
      
      if (this.noDaemon) {
        await new Promise(() => {});
      }
      
    } else {

      // Parse all args — parseStartFlags finds the script itself
      const opts = this.parseStartFlags(args);
  
      if (!opts.script) {
        console.error(colorize("Error: no script specified", "red"));
        process.exit(1);
      }
  
      opts.script = resolve(opts.script);
      
      if (!opts.cwd) opts.cwd = path.dirname(opts.script);
  
      const res = await this.sendToDaemon({ type: "start", data: opts });
  
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
  
      printProcessTable(res.data);
  
      if (this.noDaemon) {
        await new Promise(() => {});
      }
    }
  }

  async cmdStop(args: string[]) {
    const target = args[0] || "all";
    const type = target === "all" ? "stopAll" : "stop";
    const data = target === "all" ? undefined : { target };

    const res = await this.sendToDaemon({ type, data });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
  }

  async cmdRestart(args: string[]) {
    const target = args[0] || "all";
    const type = target === "all" ? "restartAll" : "restart";
    const data = target === "all" ? undefined : { target };

    const res = await this.sendToDaemon({ type, data });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
  }

  async cmdReload(args: string[]) {
    const target = args[0] || "all";
    const type = target === "all" ? "reloadAll" : "reload";
    const data = target === "all" ? undefined : { target };

    const res = await this.sendToDaemon({ type, data });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
  }

  async cmdDelete(args: string[]) {
    const target = args[0] || "all";
    const type = target === "all" ? "deleteAll" : "delete";
    const data = target === "all" ? undefined : { target };

    const res = await this.sendToDaemon({ type, data });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process?.exit(1);
    }

    console.log(colorize("✓ Deleted", "green"));
    printProcessTable(res.data);
  }

  async cmdList(args: string[]) {
    const res = await this.sendToDaemon({ type: "list" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }

    const liveMode = args.includes("--live");

    if (liveMode) {
      liveWatchProcess(res.data);
    } else {
      printProcessTable(res.data);
    }
  }

  async cmdDescribe(args: string[]) {
    const target = args[0];
    if (!target) {
      console.error(colorize("Usage: bm2 describe <id|name>", "red"));
      process.exit(1);
    }

    const res = await this.sendToDaemon({ type: "describe", data: { target } });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }

    const processes: ProcessState[] = res.data;
    for (const p of processes) {
      console.log(colorize(`\n─── ${p.name} (id: ${p.pm_id}) ───`, "bold"));
      console.log(`  Status       : ${colorize(p.status, statusColor(p.status))}`);
      console.log(`  PID          : ${p.pid || "N/A"}`);
      console.log(`  Exec mode    : ${p.bm2_env.execMode}`);
      console.log(`  Instances    : ${p.bm2_env.instances}`);
      console.log(`  Namespace    : ${p.namespace || "default"}`);
      console.log(`  Script       : ${p.bm2_env.script}`);
      console.log(`  CWD          : ${p.bm2_env.cwd}`);
      console.log(`  Args         : ${p.bm2_env.args.join(" ") || "(none)"}`);
      console.log(`  Interpreter  : ${p.bm2_env.interpreter || "bun"}`);
      console.log(`  Restarts     : ${p.bm2_env.restart_time}`);
      console.log(`  Unstable     : ${p.bm2_env.unstable_restarts}`);
      console.log(
        `  Uptime       : ${
          p.status === "online" ? formatUptime(Date.now() - p.bm2_env.pm_uptime) : "N/A"
        }`
      );
      console.log(`  Created at   : ${new Date(p.bm2_env.created_at).toISOString()}`);
      console.log(`  CPU          : ${p.monit.cpu.toFixed(1)}%`);
      console.log(`  Memory       : ${formatBytes(p.monit.memory)}`);
      if (p.monit.handles !== undefined) console.log(`  Handles      : ${p.monit.handles}`);
      if (p.monit.eventLoopLatency !== undefined)
        console.log(`  EL Latency   : ${p.monit.eventLoopLatency.toFixed(2)} ms`);
      console.log(`  Watch        : ${p.bm2_env.watch}`);
      console.log(`  Autorestart  : ${p.bm2_env.autorestart}`);
      console.log(`  Max restarts : ${p.bm2_env.maxRestarts}`);
      console.log(`  Kill timeout : ${p.bm2_env.killTimeout} ms`);
      if (p.bm2_env.healthCheckUrl) console.log(`  Health URL   : ${p.bm2_env.healthCheckUrl}`);
      if (p.bm2_env.cronRestart) console.log(`  Cron restart : ${p.bm2_env.cronRestart}`);
      if (p.bm2_env.port) console.log(`  Port         : ${p.bm2_env.port}`);
      console.log();
    }
  }
  
  async cmdLogs(args: string[]) {
    let target: string | number = "all";
    let lines = 20;
    let follow = false;
  
    let i = 0;
  
    while (i < args.length) {
      const arg = args[i]!;
  
      if ((arg === "--lines" || arg === "-l") && !Number.isNaN(Number(args[i + 1]))) {
        lines = parseInt(args[i + 1]!);
        i++; // skip value
      } else if (arg.startsWith("--lines=")) {
        lines = parseInt(arg.split("=")[1]!);
      } else if (arg === "--follow" || arg === "-f") {
        follow = true;
      } else if (!arg.startsWith("-")) {
        target = arg;
      }
  
      i++;
    }
  
    console.log("target===>", target);
    console.log("lines===>", lines);
    console.log("follow===>", follow);
  
    if (follow) {
      
      await this.sendToDaemon({
        type: "streamLogs",
        data: { target },
      });
      
    } else {
      const res = await this.sendToDaemon({
        type: "logs",
        data: { target, lines },
      });
  
      if (!res.success) {
        console.error(colorize(`Error: ${res.error}`, "red"));
        process.exit(1);
      }
  
      for (const log of res.data) {
        console.log(colorize(`\n─── ${log.name} (id: ${log.id}) ───`, "bold"));
        if (log.out) {
          console.log(colorize("--- stdout ---", "dim"));
          console.log(log.out);
        }
        if (log.err) {
          console.log(colorize("--- stderr ---", "red"));
          console.log(log.err);
        }
      }
    }
  }

  async cmdFlush(args: string[]) {
    const target = args[0];
    const res = await this.sendToDaemon({ type: "flush", data: target ? { target } : undefined });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize("✓ Logs flushed", "green"));
  }

  async cmdScale(args: string[]) {
    const target = args[0];
    const count = parseInt(args[1]!);
    if (!target || isNaN(count)) {
      console.error(colorize("Usage: bm2 scale <name|id> <count>", "red"));
      process.exit(1);
    }

    const res = await this.sendToDaemon({ type: "scale", data: { target, count } });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
  }

  async cmdSave() {
    const res = await this.sendToDaemon({ type: "save" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize("✓ Process list saved", "green"));
  }

  async cmdResurrect() {
    const res = await this.sendToDaemon({ type: "resurrect" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    printProcessTable(res.data);
  }

  async cmdSignal(args: string[]) {
    const signal = args[0];
    const target = args[1];
    if (!signal || !target) {
      console.error(colorize("Usage: bm2 sendSignal <signal> <id|name>", "red"));
      process.exit(1);
    }

    const res = await this.sendToDaemon({ type: "signal", data: { target, signal } });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize(`✓ Signal ${signal} sent to ${target}`, "green"));
  }

  async cmdReset(args: string[]) {
    const target = args[0] || "all";
    const res = await this.sendToDaemon({ type: "reset", data: { target } });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize("✓ Restart counters reset", "green"));
    printProcessTable(res.data);
  }

  async cmdMonit() {
    const res = await this.sendToDaemon({ type: "metrics" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }

    const snapshot = res.data;
    console.log(colorize("\n⚡ BM2 Monitor\n", "bold"));

    console.log(colorize("System:", "cyan"));
    console.log(`  Platform : ${snapshot.system.platform}`);
    console.log(`  CPUs     : ${snapshot.system.cpuCount}`);
    console.log(
      `  Memory   : ${formatBytes(
        snapshot.system.totalMemory - snapshot.system.freeMemory
      )} / ${formatBytes(snapshot.system.totalMemory)}`
    );
    console.log(`  Load avg : ${snapshot.system.loadAvg.map((l: number) => l.toFixed(2)).join(", ")}`);
    console.log();

    console.log(colorize("Processes:", "cyan"));
    for (const p of snapshot.processes) {
      const statusStr = colorize(padRight(p.status, 14), statusColor(p.status));
      console.log(
        `  ${padRight(String(p.id), 4)} ${padRight(p.name, 20)} ${statusStr} CPU: ${padRight(
          p.cpu.toFixed(1) + "%",
          8
        )} MEM: ${padRight(formatBytes(p.memory), 10)} ↺ ${p.restarts}`
      );
    }
    console.log();
  }

  async cmdDashboard(args: string[]) {
    let port = DASHBOARD_PORT;
    let metricsPort = METRICS_PORT;

    const portIdx = args.indexOf("--port");
    if (portIdx !== -1 && args[portIdx + 1]) port = parseInt(args[portIdx + 1]!);
    const mIdx = args.indexOf("--metrics-port");
    if (mIdx !== -1 && args[mIdx + 1]) metricsPort = parseInt(args[mIdx + 1]!);

    const res = await this.sendToDaemon({ type: "dashboard", data: { port, metricsPort } });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize(`✓ Dashboard running at http://localhost:${res.data.port}`, "green"));
    console.log(
      colorize(`  Prometheus metrics at http://localhost:${res.data.metricsPort}/metrics`, "dim")
    );
  }

  async cmdDashboardStop() {
    const res = await this.sendToDaemon({ type: "dashboardStop" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(colorize("✓ Dashboard stopped", "green"));
  }

  async cmdPing() {
    try {
      const res = await this.sendToDaemon({ type: "ping" });
      if (res.success) {
        console.log(colorize("✓ Daemon is alive", "green"));
        console.log(`  PID    : ${res.data.pid}`);
        console.log(`  Uptime : ${formatUptime(res.data.uptime * 1000)}`);
      } else {
        console.log(colorize("✗ Daemon responded with error", "red"));
      }
    } catch {
      console.log(colorize("✗ Daemon is not running", "red"));
    }
  }

  async cmdKill() {
    try {
      await this.sendToDaemon({ type: "kill" });
    } catch {
      // Expected — daemon exits
    }

    try {
      if (existsSync(DAEMON_SOCKET)) unlinkSync(DAEMON_SOCKET);
    } catch {}
    try {
      if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE);
    } catch {}

    console.log(colorize("✓ Daemon killed", "green"));
  }

  async cmdDeploy(args: string[]) {
    const configFile = args[0];
    const environment = args[1];

    if (!configFile || !environment) {
      console.error(colorize("Usage: bm2 deploy <config> <environment> [setup]", "red"));
      process.exit(1);
    }

    const config = await this.loadEcosystemConfig(configFile);

    if (!config.deploy || !config.deploy[environment]) {
      console.error(colorize(`Deploy environment "${environment}" not found in config`, "red"));
      process.exit(1);
    }

    const deployConfig = config.deploy[environment]!;
    const deployer = new DeployManager();

    if (args[2] === "setup") {
      await deployer.setup(deployConfig);
    } else {
      await deployer.deploy(deployConfig, args[2]);
    }
  }

  async cmdStartup(args: string[]) {
    const startup = new StartupManager();

    if (args[0] === "remove" || args[0] === "uninstall") {
      console.log(await startup.uninstall());
      return;
    }

    if (args[0] === "install") {
      console.log(await startup.install());
      return;
    }

    console.log(await startup.generate(args[0]));
  }

  async cmdEnv(args: string[]) {
    const envMgr = new EnvManager();
    const subCmd = args[0];

    switch (subCmd) {
      case "set": {
        const name = args[1];
        const key = args[2];
        const value = args[3];
        if (!name || !key || value === undefined) {
          console.error(colorize("Usage: bm2 env set <name> <key> <value>", "red"));
          process.exit(1);
        }
        await envMgr.setEnv(name, key, value);
        console.log(colorize(`✓ Set ${key}=${value} for ${name}`, "green"));
        break;
      }
      case "get": {
        const name = args[1];
        if (!name) {
          console.error(colorize("Usage: bm2 env get <name>", "red"));
          process.exit(1);
        }
        const env = await envMgr.getEnv(name);
        for (const [k, v] of Object.entries(env)) {
          console.log(`${colorize(k, "cyan")}=${v}`);
        }
        break;
      }
      case "delete":
      case "rm": {
        const name = args[1];
        const key = args[2];
        if (!name) {
          console.error(colorize("Usage: bm2 env delete <name> [key]", "red"));
          process.exit(1);
        }
        await envMgr.deleteEnv(name, key);
        console.log(colorize("✓ Deleted", "green"));
        break;
      }
      case "list": {
        const all = await envMgr.getEnvs();
        for (const [name, env] of Object.entries(all)) {
          console.log(colorize(`\n${name}:`, "bold"));
          for (const [k, v] of Object.entries(env)) {
            console.log(`  ${colorize(k, "cyan")}=${v}`);
          }
        }
        break;
      }
      default:
        console.error(colorize("Usage: bm2 env <set|get|delete|list> ...", "red"));
        process.exit(1);
    }
  }

  async cmdModule(args: string[]) {
    const subCmd = args[0];

    switch (subCmd) {
      case "install": {
        const mod = args[1];
        if (!mod) {
          console.error(colorize("Usage: bm2 module install <name|url|path>", "red"));
          process.exit(1);
        }
        const res = await this.sendToDaemon({ type: "moduleInstall", data: { module: mod } });
        if (!res.success) {
          console.error(colorize(`Error: ${res.error}`, "red"));
          process.exit(1);
        }
        console.log(colorize(`✓ Module installed at ${res.data.path}`, "green"));
        break;
      }
      case "uninstall":
      case "remove": {
        const mod = args[1];
        if (!mod) {
          console.error(colorize("Usage: bm2 module uninstall <name>", "red"));
          process.exit(1);
        }
        const res = await this.sendToDaemon({ type: "moduleUninstall", data: { module: mod } });
        if (!res.success) {
          console.error(colorize(`Error: ${res.error}`, "red"));
          process.exit(1);
        }
        console.log(colorize("✓ Module uninstalled", "green"));
        break;
      }
      case "list":
      case "ls": {
        const res = await this.sendToDaemon({ type: "moduleList" });
        if (!res.success) {
          console.error(colorize(`Error: ${res.error}`, "red"));
          process.exit(1);
        }
        if (res.data.length === 0) {
          console.log(colorize("No modules installed", "dim"));
        } else {
          for (const m of res.data) {
            console.log(`  ${colorize(m.name, "cyan")} @ ${m.version}`);
          }
        }
        break;
      }
      default:
        console.error(colorize("Usage: bm2 module <install|uninstall|list> ...", "red"));
        process.exit(1);
    }
  }

  async cmdDaemon(args: string[]) {
    const subCmd = args[0];

    const daemonStatus = () => {
      if (this.isDaemonRunning()) {
        console.log(colorize("running", "green"));
      } else {
        console.error(colorize("stopped", "red"));
      }
      process.exit(1);
    };

    switch (subCmd) {
      case "status":
        daemonStatus();
        break;
      case "start":
        await this.startDaemon();
        process.exit(0);
        break;
      case "stop":
        await this.stopDaemon();
        process.exit(0);
        break;
      case "reload":
        await this.stopDaemon();
        await this.startDaemon();
        process.exit(0);
        break;
      default:
        console.error(colorize("Usage: bm2 daemon <status|start|stop|reload>", "red"));
        process.exit(1);
    }
  }

  async cmdPrometheus() {
    const res = await this.sendToDaemon({ type: "prometheus" });
    if (!res.success) {
      console.error(colorize(`Error: ${res.error}`, "red"));
      process.exit(1);
    }
    console.log(res.data);
  }

  // -------------------------------------------------------------------------
  // Help
  // -------------------------------------------------------------------------

  printHelp() {
    console.log(`
    ${colorize("BM2", "bold")} ${colorize(`v${VERSION}`, "dim")} — Bun Process Manager
    
    ${colorize("Usage:", "bold")} bm2 <command> [options]
    
    ${colorize("Process Management:", "cyan")}
    start <script|config> [opts]  Start a process or ecosystem config
    stop [id|name|all]            Stop process(es)
    restart [id|name|all]         Restart process(es)
    reload [id|name|all]          Graceful zero-downtime reload
    delete [id|name|all]          Stop and remove process(es)
    scale <id|name> <count>       Scale to N instances
    list | ls | status            List all processes
    describe <id|name>            Show detailed process info
    reset <id|name|all>           Reset restart counters
    
    ${colorize("Logs:", "cyan")}
    logs [id|name|all] [--lines N]  Show recent logs
    flush [id|name]                 Clear log files
    
    ${colorize("Monitoring:", "cyan")}
    monit                         Show live metrics snapshot
    dashboard [--port N]          Start web dashboard
    dashboard stop                Stop web dashboard
    prometheus                    Print Prometheus metrics
    
    ${colorize("Persistence:", "cyan")}
    save                          Save current process list
    resurrect                     Restore saved process list
    startup [install|remove]      Generate/install startup script
    
    ${colorize("Deploy:", "cyan")}
    deploy <config> <env> [setup] Deploy using ecosystem config
    
    ${colorize("Environment:", "cyan")}
    env set <name> <key> <val>    Set env variable
    env get <name>                List env vars for a process
    env delete <name> [key]       Delete env variable(s)
    env list                      List all env registries
    
    ${colorize("Modules:", "cyan")}
    module install <name|url>     Install a BM2 module
    module uninstall <name>       Remove a module
    module list                   List installed modules
    
    ${colorize("Daemon:", "cyan")}
    daemon status                 Returns the status of the daemon
    daemon start                  Starts the daemon
    daemon stop                   Stops the daemon
    daemon reload                 Reloads the daemon
    
    ${colorize("Other:", "cyan")}
    ping                          Check if daemon is alive
    kill                          Kill the daemon and all processes
    sendSignal <sig> <id|name>    Send OS signal to process
    
    ${colorize("Start Options:", "dim")}
    --name, -n <name>             Process name
    --instances, -i <N>           Number of instances (cluster)
    --exec-mode, -x <mode>        fork or cluster
    --watch, -w                   Watch for file changes
    --cwd <path>                  Working directory
    --interpreter <bin>           Custom interpreter
    --node-args <args>            Extra runtime arguments
    --max-memory-restart <size>   e.g. 200M, 1G
    --max-restarts <N>            Max restart attempts
    --cron, --cron-restart <expr> Cron-based restart schedule
    --port, -p <port>             Base port for cluster
    --env <KEY=VALUE>             Set environment variable
    --no-autorestart              Disable auto-restart
    --no-daemon, -d              Run without daemon (blocks)
    --log, -o <file>              Custom stdout log path
    --error, -e <file>            Custom stderr log path
    --namespace <ns>              Namespace grouping
    --wait-ready                  Wait for ready signal
    --health-check-url <url>      HTTP health check endpoint
    -- <args...>                  Pass arguments to script
    
    ${colorize("Examples:", "dim")}
    bm2 start app.ts
    bm2 start server.ts --name api -i 4 --watch
    bm2 start --no-daemon app.ts
    bm2 start --name api --no-daemon server.ts
    bm2 start ecosystem.config.ts
    bm2 restart api
    bm2 scale api 8
    bm2 logs api --lines 100
    bm2 monit
    bm2 save && bm2 resurrect
    `);
  }

  // -------------------------------------------------------------------------
  // Main dispatch
  // -------------------------------------------------------------------------

  async run(argv: string[]) {
    const command = argv[0];
    const commandArgs = argv.slice(1);
    
    this.noDaemon = argv.includes("--no-daemon") || argv.includes("-d");

    switch (command) {
      case "start":
        await this.cmdStart(commandArgs);
        break;
      case "stop":
        await this.cmdStop(commandArgs);
        break;
      case "restart":
        await this.cmdRestart(commandArgs);
        break;
      case "reload":
        await this.cmdReload(commandArgs);
        break;
      case "delete":
      case "del":
      case "rm":
        await this.cmdDelete(commandArgs);
        break;
      case "scale":
        await this.cmdScale(commandArgs);
        break;
      case "list":
      case "ls":
      case "status":
        await this.cmdList(commandArgs);
        break;
      case "describe":
      case "show":
      case "info":
        await this.cmdDescribe(commandArgs);
        break;
      case "logs":
      case "log":
        await this.cmdLogs(commandArgs);
        break;
      case "flush":
        await this.cmdFlush(commandArgs);
        break;
      case "monit":
      case "monitor":
        await this.cmdMonit();
        break;
      case "dashboard":
        if (commandArgs[0] === "stop") {
          await this.cmdDashboardStop();
        } else {
          await this.cmdDashboard(commandArgs);
        }
        break;
      case "prometheus":
        await this.cmdPrometheus();
        break;
      case "save":
      case "dump":
        await this.cmdSave();
        break;
      case "resurrect":
      case "restore":
        await this.cmdResurrect();
        break;
      case "reset":
        await this.cmdReset(commandArgs);
        break;
      case "sendSignal":
      case "signal":
        await this.cmdSignal(commandArgs);
        break;
      case "ping":
        await this.cmdPing();
        break;
      case "kill":
        await this.cmdKill();
        break;
      case "deploy":
        await this.cmdDeploy(commandArgs);
        break;
      case "startup":
        await this.cmdStartup(commandArgs);
        break;
      case "env":
        await this.cmdEnv(commandArgs);
        break;
      case "module":
        await this.cmdModule(commandArgs);
        break;
      case "daemon":
        await this.cmdDaemon(commandArgs);
        break;
      case "version":
      case "-v":
      case "--version":
        console.log(`${APP_NAME} v${VERSION}`);
        break;
      case "help":
      case "-h":
      case "--help":
      case undefined:
        this.printHelp();
        break;
      default:
        console.error(colorize(`Unknown command: ${command}`, "red"));
        console.error(`Run ${colorize("bm2 --help", "cyan")} for usage information.`);
        process.exit(1);
    }
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

const cli = new BM2CLI();
await cli.run(process.argv.slice(2));
