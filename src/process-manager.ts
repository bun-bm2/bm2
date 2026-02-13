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
 import type {
   ProcessDescription,
   ProcessState,
   StartOptions,
   EcosystemConfig,
   MetricSnapshot,
 } from "./types";
 import { ProcessContainer } from "./process-container";
 import { LogManager } from "./log-manager";
 import { ClusterManager } from "./cluster-manager";
 import { HealthChecker } from "./health-checker";
 import { CronManager } from "./cron-manager";
 import { Monitor } from "./monitor";
 import { GracefulReload } from "./graceful-reload";
 import { parseMemory, DUMP_FILE } from "./utils";
 import {
   DEFAULT_KILL_TIMEOUT,
   DEFAULT_MAX_RESTARTS,
   DEFAULT_MIN_UPTIME,
   DEFAULT_RESTART_DELAY,
   DEFAULT_LOG_MAX_SIZE,
   DEFAULT_LOG_RETAIN,
 } from "./constants";
 
 export class ProcessManager {
   private processes: Map<number, ProcessContainer> = new Map();
   private nextId: number = 0;
   public logManager: LogManager;
   public clusterManager: ClusterManager;
   public healthChecker: HealthChecker;
   public cronManager: CronManager;
   public monitor: Monitor;
   public gracefulReload: GracefulReload;
 
   constructor() {
     this.logManager = new LogManager();
     this.clusterManager = new ClusterManager();
     this.healthChecker = new HealthChecker();
     this.cronManager = new CronManager();
     this.monitor = new Monitor();
     this.gracefulReload = new GracefulReload();
   }
 
  async start(options: StartOptions): Promise<ProcessState[]> {
        
    const resolvedInstances = this.clusterManager.resolveInstances(options.instances);
    const isCluster = options.execMode === "cluster" || resolvedInstances > 1;
    const states: ProcessState[] = [];

    if (isCluster) {
      // In cluster mode, each instance is a separate container
      for (let i = 0; i < resolvedInstances; i++) {
          
        const id = this.nextId++;
        const baseName = options.name || options.script.split("/").pop()?.replace(/\.\w+$/, "") || `app-${id}`;
        const name = resolvedInstances > 1 ? `${baseName}-${i}` : baseName;

        const config = this.buildConfig(id, name, options, resolvedInstances, i);
        
        const container = new ProcessContainer(
          id, config, this.logManager, this.clusterManager,
          this.healthChecker, this.cronManager
        );

        this.processes.set(id, container);
        await container.start();
        states.push(container.getState());
      }
    } else {
      const id = this.nextId++;
      const name =
          options.name ||
          options.script.split("/").pop()?.replace(/\.\w+$/, "") ||
          `app-${id}`;
  
      const config = this.buildConfig(id, name, options, 1, 0);
      const container = new ProcessContainer(
          id, config, this.logManager, this.clusterManager,
          this.healthChecker, this.cronManager
      );
  
      this.processes.set(id, container);
      await container.start();
      states.push(container.getState());
    }

    return states;
   }
 
   private buildConfig(
     id: number,
     name: string,
     options: StartOptions,
     instances: number,
     workerIndex: number
   ): ProcessDescription {
     return {
       id,
       name,
       script: options.script,
       args: options.args || [],
       cwd: options.cwd || process.cwd(),
       env: {
         ...options.env,
         ...(instances > 1
           ? {
               NODE_APP_INSTANCE: String(workerIndex),
               BM2_INSTANCE_ID: String(workerIndex),
             }
           : {}),
       },
       instances,
       execMode: instances > 1 ? "cluster" : (options.execMode || "fork"),
       autorestart: options.autorestart !== false,
       maxRestarts: options.maxRestarts ?? DEFAULT_MAX_RESTARTS,
       minUptime: options.minUptime ?? DEFAULT_MIN_UPTIME,
       maxMemoryRestart: options.maxMemoryRestart
         ? parseMemory(options.maxMemoryRestart)
         : undefined,
       watch: Array.isArray(options.watch) ? true : (options.watch ?? false),
       watchPaths: Array.isArray(options.watch) ? options.watch : undefined,
       ignoreWatch: options.ignoreWatch || ["node_modules", ".git", ".bm2"],
       cronRestart: options.cron,
       interpreter: options.interpreter,
       interpreterArgs: options.interpreterArgs,
       mergeLogs: options.mergeLogs ?? false,
       logDateFormat: options.logDateFormat,
       errorFile: options.errorFile,
       outFile: options.outFile,
       killTimeout: options.killTimeout ?? DEFAULT_KILL_TIMEOUT,
       restartDelay: options.restartDelay ?? DEFAULT_RESTART_DELAY,
       port: options.port,
       healthCheckUrl: options.healthCheckUrl,
       healthCheckInterval: options.healthCheckInterval,
       healthCheckTimeout: options.healthCheckTimeout,
       healthCheckMaxFails: options.healthCheckMaxFails,
       logMaxSize: options.logMaxSize ? parseMemory(options.logMaxSize) : DEFAULT_LOG_MAX_SIZE,
       logRetain: options.logRetain ?? DEFAULT_LOG_RETAIN,
       logCompress: options.logCompress,
       waitReady: options.waitReady,
       listenTimeout: options.listenTimeout,
       namespace: options.namespace,
       nodeArgs: options.nodeArgs,
       sourceMapSupport: options.sourceMapSupport,
       treekill: true,
     };
   }
 
   async stop(target: string | number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     const states: ProcessState[] = [];
     for (const c of containers) {
       await c.stop();
       states.push(c.getState());
     }
     return states;
   }
 
   async restart(target: string | number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     const states: ProcessState[] = [];
     for (const c of containers) {
       await c.restart();
       states.push(c.getState());
     }
     return states;
   }
 
   async reload(target: string | number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     // Use graceful reload for zero downtime
     await this.gracefulReload.reload(containers);
     return containers.map((c) => c.getState());
   }
 
   async del(target: string | number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     const states: ProcessState[] = [];
     for (const c of containers) {
       await c.stop(true);
       states.push(c.getState());
       this.processes.delete(c.id);
     }
     return states;
   }
 
   async stopAll(): Promise<ProcessState[]> {
     const states: ProcessState[] = [];
     for (const c of this.processes.values()) {
       await c.stop();
       states.push(c.getState());
     }
     return states;
   }
 
   async restartAll(): Promise<ProcessState[]> {
     const states: ProcessState[] = [];
     for (const c of this.processes.values()) {
       await c.restart();
       states.push(c.getState());
     }
     return states;
   }
 
   async reloadAll(): Promise<ProcessState[]> {
     const containers = Array.from(this.processes.values());
     await this.gracefulReload.reload(containers);
     return containers.map((c) => c.getState());
   }
 
   async deleteAll(): Promise<ProcessState[]> {
     const states: ProcessState[] = [];
     for (const c of this.processes.values()) {
       await c.stop(true);
       await Bun.sleep(100)
       states.push(c.getState());
     }
     this.processes.clear();
     this.nextId = 0;
     return states;
   }
 
   async scale(target: string | number, count: number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     if (containers.length === 0) return [];
   
     const first = containers[0]!;
     const baseName = first.name.replace(/-\d+$/, "");
     const currentCount = containers.length;
   
     if (count > currentCount) {
       // Scale up
       const toAdd = count - currentCount;
       const baseConfig = first.config;
       const states: ProcessState[] = [];
   
       for (let i = 0; i < toAdd; i++) {
         const result = await this.start({
           name: `${baseName}-${currentCount + i}`,
           script: baseConfig.script,
           args: baseConfig.args,
           cwd: baseConfig.cwd,
           env: baseConfig.env,
           execMode: baseConfig.execMode,
           autorestart: baseConfig.autorestart,
           maxRestarts: baseConfig.maxRestarts,
           watch: baseConfig.watch,
           port: baseConfig.port,
         });
         states.push(...result);
       }
   
       return [...containers.map((c) => c.getState()), ...states];
     } else if (count < currentCount) {
       // Scale down
       const toRemove = containers.slice(count);
       for (const c of toRemove) {
         await c.stop(true);
         this.processes.delete(c.id);
       }
       return containers.slice(0, count).map((c) => c.getState());
     }
   
     return containers.map((c) => c.getState());
   }
   
   list(): ProcessState[] {
     return Array.from(this.processes.values()).map((p) => p.getState());
   }
 
   describe(target: string | number): ProcessState[] {
     return this.resolveTarget(target).map((p) => p.getState());
   }
 
   async getLogs(target: string | number, lines: number = 20) {
     const containers = this.resolveTarget(target);
     const results: Array<{ name: string; id: number; out: string; err: string }> = [];
     for (const c of containers) {
       const logs = await this.logManager.readLogs(
         c.name, c.id, lines, c.config.outFile, c.config.errorFile
       );
       results.push({ name: c.name, id: c.id, ...logs });
     }
     return results;
   }
 
   async flushLogs(target?: string | number) {
     const containers = target
       ? this.resolveTarget(target)
       : Array.from(this.processes.values());
     for (const c of containers) {
       await this.logManager.flush(c.name, c.id, c.config.outFile, c.config.errorFile);
     }
   }
 
   async save(): Promise<void> {
     const data = Array.from(this.processes.values()).map((p) => ({
       config: p.config,
       restartCount: p.restartCount,
     }));
     await Bun.write(DUMP_FILE, JSON.stringify(data, null, 2));
   }
 
   async resurrect(): Promise<ProcessState[]> {
     try {
       const file = Bun.file(DUMP_FILE);
       if (!(await file.exists())) return [];
       const data = await file.json();
       const states: ProcessState[] = [];
 
       for (const item of data) {
         const result = await this.start({
           name: item.config.name,
           script: item.config.script,
           args: item.config.args,
           cwd: item.config.cwd,
           env: item.config.env,
           autorestart: item.config.autorestart,
           maxRestarts: item.config.maxRestarts,
           watch: item.config.watch,
           instances: 1,
           execMode: item.config.execMode,
           port: item.config.port,
           healthCheckUrl: item.config.healthCheckUrl,
         });
         states.push(...result);
       }
       return states;
     } catch {
       return [];
     }
   }
 
   async startEcosystem(config: EcosystemConfig): Promise<ProcessState[]> {
     const states: ProcessState[] = [];
     for (const app of config.apps) {
       const result = await this.start(app);
       states.push(...result);
     }
     return states;
   }
 
   async sendSignal(target: string | number, signal: string): Promise<void> {
     for (const c of this.resolveTarget(target)) {
       await c.sendSignal(signal);
     }
   }
 
   async getMetrics(): Promise<MetricSnapshot> {
     return this.monitor.takeSnapshot(this.list());
   }
 
   getPrometheusMetrics(): string {
     return this.monitor.generatePrometheusMetrics(this.list());
   }
 
   getMetricsHistory(seconds: number = 300): MetricSnapshot[] {
     return this.monitor.getHistory(seconds);
   }
 
   async reset(target: string | number): Promise<ProcessState[]> {
     const containers = this.resolveTarget(target);
     for (const c of containers) {
       c.restartCount = 0;
       c.unstableRestarts = 0;
     }
     return containers.map((c) => c.getState());
   }
 
   private resolveTarget(target: string | number): ProcessContainer[] {
     if (target === "all") {
       return Array.from(this.processes.values());
     }
 
     if (typeof target === "number" || /^\d+$/.test(String(target))) {
       const id = typeof target === "number" ? target : parseInt(target);
       const proc = this.processes.get(id);
       return proc ? [proc] : [];
     }
 
     // Match by name or namespace
     return Array.from(this.processes.values()).filter(
       (p) =>
         p.name === target ||
         p.name.startsWith(`${target}-`) ||
         p.config.namespace === target
     );
   }
 }
