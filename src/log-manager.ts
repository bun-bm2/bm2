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
import { existsSync, readdirSync, unlinkSync, renameSync, statSync } from "fs";
import { LOG_DIR, DEFAULT_LOG_MAX_SIZE, DEFAULT_LOG_RETAIN } from "./constants";
import type { LogRotateOptions } from "./types";

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
      const file = Bun.file(filePath);
      const existing = (await file.exists()) ? await file.text() : "";
      await Bun.write(filePath, existing + content);
    } catch (err) {
      // If file too large, log the error
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

    try {
      const outFile = Bun.file(paths.outFile);
      if (await outFile.exists()) {
        const text = await outFile.text();
        out = text.split("\n").slice(-lines).join("\n");
      }
    } catch {}

    try {
      const errFile = Bun.file(paths.errFile);
      if (await errFile.exists()) {
        const text = await errFile.text();
        err = text.split("\n").slice(-lines).join("\n");
      }
    } catch {}

    return { out, err };
  }

  async tailLog(
    filePath: string,
    callback: (line: string) => void,
    signal?: AbortSignal
  ): Promise<void> {
    let lastSize = 0;
    const file = Bun.file(filePath);
    if (await file.exists()) {
      lastSize = file.size;
    }

    const interval = setInterval(async () => {
      if (signal?.aborted) {
        clearInterval(interval);
        return;
      }
      try {
        const f = Bun.file(filePath);
        if (!(await f.exists())) return;
        const currentSize = f.size;
        if (currentSize > lastSize) {
          const text = await f.text();
          const newContent = text.substring(lastSize);
          lastSize = currentSize;
          for (const line of newContent.split("\n").filter(Boolean)) {
            callback(line);
          }
        }
      } catch {}
    }, 500);
  }

  async rotate(filePath: string, options: LogRotateOptions): Promise<void> {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return;

      const stat = statSync(filePath);
      if (stat.size < options.maxSize) return;

      // Rotate files
      for (let i = options.retain - 1; i >= 1; i--) {
        const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
        const dst = `${filePath}.${i}`;
        if (existsSync(src)) {
          renameSync(src, dst);

          if (options.compress && i > 0) {
            // Compress rotated file using Bun's gzip
            try {
              const content = await Bun.file(dst).arrayBuffer();
              const compressed = Bun.gzipSync(new Uint8Array(content));
              await Bun.write(`${dst}.gz`, compressed);
              unlinkSync(dst);
            } catch {}
          }
        }
      }

      // Clean excess rotated files
      const dir = dirname(filePath);
      const baseName = filePath.split("/").pop()!;
      try {
        const files = readdirSync(dir);
        const rotated = files
          .filter((f) => f.startsWith(baseName + "."))
          .sort()
          .reverse();
        for (let i = options.retain; i < rotated.length; i++) {
          unlinkSync(join(dir, rotated[i]));
        }
      } catch {}

      // Truncate original
      await Bun.write(filePath, "");
    } catch (err) {
      console.error(`[bm2] Log rotation failed for ${filePath}:`, err);
    }
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
