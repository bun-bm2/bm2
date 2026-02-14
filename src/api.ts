/**
 * BM2 — Bun Process Manager
 * Programmatic API
 *
 * Usage:
 *   import BM2 from "bm2";
 *   const bm2 = new BM2();
 *   await bm2.connect();
 *   const list = await bm2.list();
 *   await bm2.start({ script: "./app.ts", name: "my-app" });
 *   await bm2.disconnect();
 *
 * License: GPL-3.0-only
 * Author: Zak <zak@maxxpainn.com>
 */

import { EventEmitter } from "events";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { resolve } from "path";
import {
  DAEMON_SOCKET,
  DAEMON_PID_FILE,
  BM2_HOME,
  DASHBOARD_PORT,
  METRICS_PORT,
  DAEMON_OUT_LOG_FILE,
  DAEMON_ERR_LOG_FILE,
} from "./constants";
import { ensureDirs, generateId } from "./utils";
import type {
  DaemonMessage,
  DaemonResponse,
  StartOptions,
  EcosystemConfig,
  ProcessState,
  MetricSnapshot,
  ProcessStatus,
} from "./types";

// ────────────────────────────────────────────────────────────────────────────
// Bus event types emitted by BM2
// ────────────────────────────────────────────────────────────────────────────

export interface BM2Events {
  /** Daemon successfully connected */
  "daemon:connected": [];
  /** Daemon connection lost */
  "daemon:disconnected": [];
  /** Daemon launched by this client */
  "daemon:launched": [pid: number];
  /** Daemon killed */
  "daemon:killed": [];
  /** Error on the transport layer */
  "error": [error: Error];
  /** Process started */
  "process:start": [processes: ProcessState[]];
  /** Process stopped */
  "process:stop": [processes: ProcessState[]];
  /** Process restarted */
  "process:restart": [processes: ProcessState[]];
  /** Process reloaded */
  "process:reload": [processes: ProcessState[]];
  /** Process deleted */
  "process:delete": [processes: ProcessState[]];
  /** Process scaled */
  "process:scale": [processes: ProcessState[]];
  /** Metrics snapshot received */
  "metrics": [snapshot: MetricSnapshot];
  /** Log data received */
  "log:data": [logs: Array<{ name: string; id: number; out: string; err: string }>];
}

// ────────────────────────────────────────────────────────────────────────────
// Main API class
// ────────────────────────────────────────────────────────────────────────────

export class BM2 extends EventEmitter<BM2Events> {
  private _connected: boolean = false;
  private _daemonPid: number | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  /** Whether the client believes the daemon is reachable. */
  get connected(): boolean {
    return this._connected;
  }

  /** PID of the daemon process (if known). */
  get daemonPid(): number | null {
    return this._daemonPid;
  }

  // ──────────────────────────── lifecycle ────────────────────────────────

  /**
   * Connect to the BM2 daemon.
   * If the daemon is not running it will be spawned automatically
   * (same behaviour as the CLI).
   */
  async connect(): Promise<this> {
    ensureDirs();

    if (!(await this.isDaemonAlive())) {
      await this.launchDaemon();
    }

    // Verify connectivity
    const pong = await this.send({ type: "ping" });
    if (!pong.success) {
      throw new Error("Failed to connect to BM2 daemon");
    }

    this._connected = true;
    this._daemonPid = pong.data?.pid ?? null;
    this.emit("daemon:connected");

    return this;
  }

  /**
   * Disconnect from the daemon. Stops any internal polling but does **not**
   * kill the daemon — processes keep running.
   */
  async disconnect(): Promise<void> {
    this.stopPolling();
    this._connected = false;
    this.emit("daemon:disconnected");
  }

  // ─────────────────────── process management ───────────────────────────

  /**
   * Start a new process (or ecosystem).
   *
   * ```ts
   * await bm2.start({ script: "./server.ts", name: "api", instances: 4 });
   * ```
   */
  async start(options: StartOptions): Promise<ProcessState[]> {
    if (options.script) {
      options.script = resolve(options.script);
    }
    const res = await this.sendOrThrow({ type: "start", data: options });
    this.emit("process:start", res.data);
    return res.data;
  }

  /**
   * Start an ecosystem configuration object.
   *
   * ```ts
   * await bm2.startEcosystem({ apps: [{ script: "./a.ts" }, { script: "./b.ts" }] });
   * ```
   */
  async startEcosystem(config: EcosystemConfig): Promise<ProcessState[]> {
    // Resolve scripts to absolute paths
    for (const app of config.apps) {
      if (app.script) app.script = resolve(app.script);
    }
    const res = await this.sendOrThrow({ type: "ecosystem", data: config });
    this.emit("process:start", res.data);
    return res.data;
  }

  /**
   * Stop one or more processes.
   * @param target Process id, name, namespace, or `"all"`.
   */
  async stop(target: string | number = "all"): Promise<ProcessState[]> {
    const type = target === "all" ? "stopAll" : "stop";
    const data = target === "all" ? undefined : { target: String(target) };
    const res = await this.sendOrThrow({ type, data });
    this.emit("process:stop", res.data);
    return res.data;
  }

  /**
   * Restart one or more processes (hard restart).
   */
  async restart(target: string | number = "all"): Promise<ProcessState[]> {
    const type = target === "all" ? "restartAll" : "restart";
    const data = target === "all" ? undefined : { target: String(target) };
    const res = await this.sendOrThrow({ type, data });
    this.emit("process:restart", res.data);
    return res.data;
  }

  /**
   * Graceful zero-downtime reload.
   */
  async reload(target: string | number = "all"): Promise<ProcessState[]> {
    const type = target === "all" ? "reloadAll" : "reload";
    const data = target === "all" ? undefined : { target: String(target) };
    const res = await this.sendOrThrow({ type, data });
    this.emit("process:reload", res.data);
    return res.data;
  }

  /**
   * Stop and remove one or more processes from BM2's list.
   */
  async delete(target: string | number = "all"): Promise<ProcessState[]> {
    const type = target === "all" ? "deleteAll" : "delete";
    const data = target === "all" ? undefined : { target: String(target) };
    const res = await this.sendOrThrow({ type, data });
    this.emit("process:delete", res.data);
    return res.data;
  }

  /**
   * Scale a process group to `count` instances.
   */
  async scale(target: string | number, count: number): Promise<ProcessState[]> {
    const res = await this.sendOrThrow({
      type: "scale",
      data: { target: String(target), count },
    });
    this.emit("process:scale", res.data);
    return res.data;
  }

  /**
   * Send an OS signal to a process.
   */
  async sendSignal(target: string | number, signal: string): Promise<void> {
    await this.sendOrThrow({
      type: "signal",
      data: { target: String(target), signal },
    });
  }

  /**
   * Reset restart counters for one or more processes.
   */
  async reset(target: string | number = "all"): Promise<ProcessState[]> {
    const res = await this.sendOrThrow({
      type: "reset",
      data: { target: String(target) },
    });
    return res.data;
  }

  // ───────────────────────── introspection ──────────────────────────────

  /**
   * List all managed processes.
   */
  async list(): Promise<ProcessState[]> {
    const res = await this.sendOrThrow({ type: "list" });
    return res.data;
  }

  /**
   * Get detailed description(s) of a process.
   */
  async describe(target: string | number): Promise<ProcessState[]> {
    const res = await this.sendOrThrow({
      type: "describe",
      data: { target: String(target) },
    });
    return res.data;
  }

  // ────────────────────────── logs ───────────────────────────────────────

  /**
   * Retrieve recent log lines.
   */
  async logs(
    target: string | number = "all",
    lines: number = 20
  ): Promise<Array<{ name: string; id: number; out: string; err: string }>> {
    const res = await this.sendOrThrow({
      type: "logs",
      data: { target: String(target), lines },
    });
    this.emit("log:data", res.data);
    return res.data;
  }

  /**
   * Flush (truncate) log files for one or all processes.
   */
  async flush(target?: string | number): Promise<void> {
    await this.sendOrThrow({
      type: "flush",
      data: target !== undefined ? { target: String(target) } : undefined,
    });
  }

  // ──────────────────────── monitoring ───────────────────────────────────

  /**
   * Take a single metrics snapshot.
   */
  async metrics(): Promise<MetricSnapshot> {
    const res = await this.sendOrThrow({ type: "metrics" });
    this.emit("metrics", res.data);
    return res.data;
  }

  /**
   * Get historical metric snapshots.
   * @param seconds Look-back window (default 300 = 5 min).
   */
  async metricsHistory(seconds: number = 300): Promise<MetricSnapshot[]> {
    const res = await this.sendOrThrow({
      type: "metricsHistory",
      data: { seconds },
    });
    return res.data;
  }

  /**
   * Get Prometheus-formatted metrics string.
   */
  async prometheus(): Promise<string> {
    const res = await this.sendOrThrow({ type: "prometheus" });
    return res.data;
  }

  /**
   * Start polling metrics at a fixed interval and emitting `"metrics"` events.
   *
   * ```ts
   * bm2.on("metrics", (snapshot) => console.log(snapshot));
   * bm2.startPolling(2000);
   * ```
   */
  startPolling(intervalMs: number = 2000): void {
    this.stopPolling();
    this._pollTimer = setInterval(async () => {
      try {
        await this.metrics();
      } catch (err) {
        this.emit("error", err instanceof Error ? err : new Error(String(err)));
      }
    }, intervalMs);
  }

  /** Stop the metrics polling loop started by `startPolling()`. */
  stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // ────────────────────── persistence ───────────────────────────────────

  /**
   * Persist the current process list to disk so it can be restored later.
   */
  async save(): Promise<void> {
    await this.sendOrThrow({ type: "save" });
  }

  /**
   * Restore previously saved processes.
   */
  async resurrect(): Promise<ProcessState[]> {
    const res = await this.sendOrThrow({ type: "resurrect" });
    return res.data;
  }

  // ────────────────────── dashboard ─────────────────────────────────────

  /**
   * Start the web dashboard.
   */
  async dashboard(
    port: number = DASHBOARD_PORT,
    metricsPort: number = METRICS_PORT
  ): Promise<{ port: number; metricsPort: number }> {
    const res = await this.sendOrThrow({
      type: "dashboard",
      data: { port, metricsPort },
    });
    return res.data;
  }

  /**
   * Stop the web dashboard.
   */
  async dashboardStop(): Promise<void> {
    await this.sendOrThrow({ type: "dashboardStop" });
  }

  // ────────────────────── modules ───────────────────────────────────────

  /**
   * Install a BM2 module.
   */
  async moduleInstall(nameOrPath: string): Promise<{ path: string }> {
    const res = await this.sendOrThrow({
      type: "moduleInstall",
      data: { module: nameOrPath },
    });
    return res.data;
  }

  /**
   * Uninstall a BM2 module.
   */
  async moduleUninstall(name: string): Promise<void> {
    await this.sendOrThrow({
      type: "moduleUninstall",
      data: { module: name },
    });
  }

  /**
   * List installed modules.
   */
  async moduleList(): Promise<Array<{ name: string; version: string }>> {
    const res = await this.sendOrThrow({ type: "moduleList" });
    return res.data;
  }

  // ────────────────────── daemon lifecycle ──────────────────────────────

  /**
   * Ping the daemon. Returns daemon PID and uptime.
   */
  async ping(): Promise<{ pid: number; uptime: number }> {
    const res = await this.sendOrThrow({ type: "ping" });
    return res.data;
  }

  /**
   * Kill the daemon and all managed processes.
   */
  async kill(): Promise<void> {
    try {
      await this.send({ type: "kill" });
    } catch {
      // Expected — daemon exits before responding
    }

    // Clean up leftover files
    try { if (existsSync(DAEMON_SOCKET)) unlinkSync(DAEMON_SOCKET); } catch {}
    try { if (existsSync(DAEMON_PID_FILE)) unlinkSync(DAEMON_PID_FILE); } catch {}

    this._connected = false;
    this._daemonPid = null;
    this.stopPolling();
    this.emit("daemon:killed");
  }

  /**
   * Reload the daemon server itself.
   */
  async daemonReload(): Promise<string> {
    const res = await this.sendOrThrow({ type: "daemonReload" });
    return res.data;
  }

  // ────────────────────── internal transport ────────────────────────────

  /**
   * Low-level: send an arbitrary message to the daemon and return the
   * raw response. Useful for custom or future command types.
   */
  async send(message: DaemonMessage): Promise<DaemonResponse> {
    
    if (!message.id) {
      message.id = generateId();
    }

    const body = JSON.stringify(message);

    // Bun supports fetching over Unix sockets with the `unix` option
    const response = await fetch(`http://localhost/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      unix: DAEMON_SOCKET,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Daemon HTTP ${response.status}: ${text}`);
    }

    return (await response.json()) as DaemonResponse;
  }

  // ────────────────────── private helpers ───────────────────────────────

  /** Send and throw a friendly error if `success` is false. */
  private async sendOrThrow(message: DaemonMessage): Promise<DaemonResponse> {
    const res = await this.send(message);
    if (!res.success) {
      throw new BM2Error(
        res.error || `Command "${message.type}" failed`,
        message.type,
        res
      );
    }
    return res;
  }

  /** Check whether the daemon is running and reachable. */
  private async isDaemonAlive(): Promise<boolean> {
    // Quick PID-file check first
    if (existsSync(DAEMON_PID_FILE)) {
      try {
        const pid = parseInt(readFileSync(DAEMON_PID_FILE, "utf-8").trim());
        process.kill(pid, 0); // throws if process doesn't exist
      } catch {
        // Stale PID file
        return false;
      }
    } else {
      return false;
    }

    // Verify the socket is responsive
    if (!existsSync(DAEMON_SOCKET)) return false;

    try {
      const res = await this.send({ type: "ping" });
      return res.success;
    } catch {
      return false;
    }
  }

  /**
   * Launch the daemon as a detached background process.
   * Waits up to 5 seconds for it to become responsive.
   */
  private async launchDaemon(): Promise<void> {
    const daemonScript = join(import.meta.dir, "daemon.ts");
    const bunPath = Bun.which("bun") || "bun";

    // Open log files for daemon stdout/stderr
    const outLog = Bun.file(DAEMON_OUT_LOG_FILE);
    const errLog = Bun.file(DAEMON_ERR_LOG_FILE);

    const proc = Bun.spawn([bunPath, "run", daemonScript], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env as Record<string, string> },
    });

    // Detach — we don't want to keep a handle
    proc.unref();

    // Poll until daemon is responsive (up to 5 s)
    const deadline = Date.now() + 5000;
    let alive = false;

    while (Date.now() < deadline) {
      await Bun.sleep(200);
      try {
        if (existsSync(DAEMON_SOCKET)) {
          const res = await this.send({ type: "ping" });
          if (res.success) {
            alive = true;
            this._daemonPid = res.data?.pid ?? proc.pid;
            break;
          }
        }
      } catch {
        // Not ready yet — keep waiting
      }
    }

    if (!alive) {
      throw new Error(
        "Timed out waiting for BM2 daemon to start. " +
        `Check ${DAEMON_ERR_LOG_FILE} for details.`
      );
    }

    this.emit("daemon:launched", this._daemonPid!);
  }
}

// ────────────────────────── error class ─────────────────────────────────

export class BM2Error extends Error {
  /** The daemon command type that failed. */
  public readonly command: string;
  /** The full daemon response. */
  public readonly response: DaemonResponse;

  constructor(message: string, command: string, response: DaemonResponse) {
    super(message);
    this.name = "BM2Error";
    this.command = command;
    this.response = response;
  }
}

// ────────────────────────── default export ──────────────────────────────

export default BM2;
