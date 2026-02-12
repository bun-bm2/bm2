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
 import type { Subprocess } from "bun";
 import type { ProcessDescription } from "./types";
 import { getCpuCount } from "./utils";
 
 export class ClusterManager {
   private workers: Map<number, Map<number, Subprocess>> = new Map();
 
   resolveInstances(instances: number | string | undefined): number {
     if (instances === undefined || instances === 0) return 1;
     if (typeof instances === "string") {
       if (instances === "max" || instances === "-1") return getCpuCount();
       return parseInt(instances) || 1;
     }
     if (instances === -1) return getCpuCount();
     return instances;
   }
 
   createWorkerEnv(
     baseEnv: Record<string, string>,
     workerId: number,
     totalWorkers: number,
     basePort?: number
   ): Record<string, string> {
     return {
       ...baseEnv,
       BM2_CLUSTER: "true",
       BM2_WORKER_ID: String(workerId),
       BM2_INSTANCES: String(totalWorkers),
       NODE_APP_INSTANCE: String(workerId),
       ...(basePort ? { PORT: String(basePort + workerId) } : {}),
     };
   }
 
   buildWorkerCommand(config: ProcessDescription): string[] {
     const cmd: string[] = [];
 
     if (config.interpreter) {
       cmd.push(config.interpreter);
       if (config.interpreterArgs) cmd.push(...config.interpreterArgs);
     } else {
       const ext = config.script.split(".").pop()?.toLowerCase();
       if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx" || ext === "mjs") {
         cmd.push("bun", "run");
       } else if (ext === "py") {
         cmd.push("python3");
       } else {
         cmd.push("bun", "run");
       }
     }
 
     if (config.nodeArgs?.length) {
       cmd.push(...config.nodeArgs);
     }
 
     cmd.push(config.script);
     if (config.args?.length) cmd.push(...config.args);
 
     return cmd;
   }
 
   spawnWorker(
     config: ProcessDescription,
     workerId: number,
     totalWorkers: number,
     logStreams: { stdout: "pipe" | "inherit"; stderr: "pipe" | "inherit" }
   ): Subprocess {
     const cmd = this.buildWorkerCommand(config);
     const env = this.createWorkerEnv(
       { ...process.env as Record<string, string>, ...config.env },
       workerId,
       totalWorkers,
       config.port
     );
 
     const proc = Bun.spawn(cmd, {
       cwd: config.cwd || process.cwd(),
       env,
       stdout: logStreams.stdout,
       stderr: logStreams.stderr,
       stdin: "ignore",
     });
 
     if (!this.workers.has(config.id)) {
       this.workers.set(config.id, new Map());
     }
     this.workers.get(config.id)!.set(workerId, proc);
 
     return proc;
   }
 
   getWorkers(processId: number): Map<number, Subprocess> | undefined {
     return this.workers.get(processId);
   }
 
   removeWorker(processId: number, workerId: number) {
     this.workers.get(processId)?.delete(workerId);
   }
 
   removeAllWorkers(processId: number) {
     this.workers.delete(processId);
   }
 }
