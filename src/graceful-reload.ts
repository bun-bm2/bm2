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
 import type { ProcessContainer } from "./process-container";
 
 export class GracefulReload {
     async reload(
       containers: ProcessContainer[],
       options: {
         delay?: number;
         listenTimeout?: number;
       } = {}
     ): Promise<void> {
       const delay = options.delay || 1000;
       const listenTimeout = options.listenTimeout || 3000;
     
       for (let i = 0; i < containers.length; i++) {
         const container = containers[i];
         if (!container) continue;
         
         const oldPid = container.pid;
     
         console.log(`[bm2] Graceful reload: reloading ${container.name} (${i + 1}/${containers.length})`);
     
         const startPromise = container.start();
     
         if (container.config.waitReady) {
           await Promise.race([
             new Promise<void>((resolve) => {
               const checkReady = setInterval(() => {
                 if (container.status === "online") {
                   clearInterval(checkReady);
                   resolve();
                 }
               }, 100);
             }),
             new Promise<void>((resolve) =>
               setTimeout(resolve, listenTimeout)
             ),
           ]);
         } else {
           await startPromise;
           await new Promise((resolve) => setTimeout(resolve, delay));
         }
     
         if (oldPid) {
           try {
             process.kill(oldPid, "SIGTERM");
           } catch {}
         }
     
         if (i < containers.length - 1) {
           await new Promise((resolve) => setTimeout(resolve, delay));
         }
       }
     
       console.log(`[bm2] Graceful reload complete`);
     }
 }
