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

import { join, dirname } from "path";
import { appendFile, rename, unlink, readdir } from "fs/promises";
import { LOG_DIR, DEFAULT_LOG_MAX_SIZE, DEFAULT_LOG_RETAIN } from "./constants";
import type { LogRotateOptions } from "./types";
import { watch } from "fs";
import type { ReadableStreamController } from "bun";
import { $ } from "bun"

export class LogManager {
  
  private writeBuffers: Map<string, string[]> = new Map();
  private flushTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  getLogPaths(name: string, id: number, customOut?: string, customErr?: string) {
    return {
      outFile: customOut || join(LOG_DIR, `${name}-${id}-out.log`),
      errFile: customErr || join(LOG_DIR, `${name}-${id}-error.log`),
    };
  }

  async appendLog(filePath: string, data: string | Uint8Array) {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);

    // Buffer writes for performance
    if (!this.writeBuffers.has(filePath)) {
      this.writeBuffers.set(filePath, []);
    }
    this.writeBuffers.get(filePath)!.push(text);

    // Debounced flush
    if (!this.flushTimers.has(filePath)) {
      this.flushTimers.set(filePath, setTimeout(() => {
        this.flushBuffer(filePath);
      }, 100));
    }
  }

  private async flushBuffer(filePath: string) {
    const buffer = this.writeBuffers.get(filePath);
    if (!buffer || buffer.length === 0) return;

    const content = buffer.join("");
    this.writeBuffers.set(filePath, []);
    this.flushTimers.delete(filePath);

    try {
      // Use appendFile (O_APPEND) instead of read-entire-file-then-rewrite.
      // The old Bun.write approach pulled the whole log into a JS string on
      // every flush — O(file size) memory per flush, quadratic overall.
      // appendFile seeks to EOF at the kernel level and writes only new bytes.
      await appendFile(filePath, content, { encoding: "utf8" });
    } catch (err) {
      console.error(`[bm2] Failed to write log: ${filePath}`, err);
    }
  }

  async forceFlush() {
    for (const [filePath] of this.writeBuffers) {
      await this.flushBuffer(filePath);
    }
  }

  async readLogs(
    name: string,
    id: number,
    lines: number = 20,
    customOut?: string,
    customErr?: string
  ): Promise<{ out: string; err: string }> {
    
    const paths = this.getLogPaths(name, id, customOut, customErr);
    let out = "";
    let err = "";
    
    const results: string[] = []
      //console.log("lines===>", lines)
    
    Object.values(paths).forEach(async (fp) => {
      const f = Bun.file(fp);
      if (!(await f.exists())) return;
      
      const prefix = fp == paths.errFile ? "Error:" : "Output";
      
      const logArr = (await $`tail -n ${lines} ${fp}`.text()).split("\n")
      
      console.log("logArr===>", logArr)
    })
    

    return { out, err };
  }

  async tailLog(filePath: string, streamController: ReadableStreamController<any>, signal: any): Promise<void> {
    
    let lastSize = (await Bun.file(filePath).exists()) ? Bun.file(filePath).size : 0;
      
    const watcher = watch(filePath, async () => {
      
      const f = Bun.file(filePath);
      
      if (f.size <= lastSize) return;

      const chunk = await f.slice(lastSize, f.size).text();
      lastSize = f.size;

      chunk.split("\n").filter(Boolean).forEach(streamController.enqueue);
      
    });
    
    signal?.addEventListener("abort", () => {
      watcher.close();
    });
  }

  async rotate(filePath: string, options: LogRotateOptions): Promise<void> {
    
    const file = Bun.file(filePath);
    
    if (!(await file.exists()) || file.size < options.maxSize) return;
  
    const bgTasks: Promise<any>[] = [];
  
    for (let i = options.retain - 1; i >= 1; i--) {
      
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
  
      if (await Bun.file(src).exists()) {
        
        await rename(src, dst);
        if (options.compress) {
          // Fire-and-forget compression doesn't block the next rename
          bgTasks.push(Bun.spawn(["gzip", "-f", dst]).exited); 
        }
      }
    }
  
    await Bun.write(filePath, ""); // Instantly truncate and reclaim space
  
    const dir = dirname(filePath);
    const baseName = filePath.split("/").pop()!;
  
    // Background cleanup
    bgTasks.push(
      readdir(dir).then(files =>
        Promise.all(
          files.filter(f => f.startsWith(`${baseName}.`)).sort().reverse()
            .slice(options.retain).map(f => unlink(join(dir, f)).catch(() => {}))
        )
      ).catch(() => {})
    );
  
    // Let Bun handle the heavy lifting in the background!
    Promise.all(bgTasks).catch(() => {}); 
  }

  async flush(name: string, id: number, customOut?: string, customErr?: string) {
    const paths = this.getLogPaths(name, id, customOut, customErr);
    try { await Bun.write(paths.outFile, ""); } catch {}
    try { await Bun.write(paths.errFile, ""); } catch {}
  }

  async checkRotation(
    name: string,
    id: number,
    options: LogRotateOptions,
    customOut?: string,
    customErr?: string
  ) {
    const paths = this.getLogPaths(name, id, customOut, customErr);
    await this.rotate(paths.outFile, options);
    await this.rotate(paths.errFile, options);
  }
}
