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
import { openSync, readSync, closeSync } from "fs";
import { appendFile, stat, rename, unlink, readdir, access } from "fs/promises";
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
        if (currentSize <= lastSize) return;

        const byteLength = currentSize - lastSize;

        // Read only the new bytes via fs.readSync to avoid:
        //   1. Loading the entire file into memory on every poll.
        //   2. Slicing by character offset (lastSize) on a UTF-8 string,
        //      which silently corrupts multi-byte sequences.
        const buf = Buffer.allocUnsafe(byteLength);
        const fd = openSync(filePath, "r");
        try {
          readSync(fd, buf, 0, byteLength, lastSize);
        } finally {
          closeSync(fd);
        }

        lastSize = currentSize;

        const newContent = new TextDecoder().decode(buf);
        for (const line of newContent.split("\n").filter(Boolean)) {
          callback(line);
        }
      } catch {}
    }, 500);
  }

  async rotate(filePath: string, options: LogRotateOptions): Promise<void> {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return;

      // Async stat — no thread-blocking syscall on the main event loop
      const fileStat = await stat(filePath);
      if (fileStat.size < options.maxSize) return;

      // Rotate files: shift .N → .N+1, filePath → .1
      for (let i = options.retain - 1; i >= 1; i--) {
        const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
        const dst = `${filePath}.${i}`;

        const srcExists = await access(src).then(() => true).catch(() => false);
        if (!srcExists) continue;

        await rename(src, dst);

        if (options.compress) {
          // Spawn the system `gzip` binary as a background subprocess so
          // compression never blocks the JS event loop. gzip -f replaces
          // `dst` with `dst.gz` in-place, matching the old .gz naming.
          try {
            const proc = Bun.spawn(["gzip", "-f", dst], {
              stdout: "ignore",
              stderr: "pipe",
            });
            const exitCode = await proc.exited;
            if (exitCode !== 0) {
              const errText = await new Response(proc.stderr).text();
              console.error(`[bm2] gzip failed for ${dst}: ${errText.trim()}`);
            }
          } catch (compressErr) {
            console.error(`[bm2] Failed to compress rotated log ${dst}:`, compressErr);
          }
        }
      }

      // Clean excess rotated files asynchronously
      const dir = dirname(filePath);
      const baseName = filePath.split("/").pop()!;
      try {
        const files = await readdir(dir);
        const rotated = files
          .filter((f) => f.startsWith(baseName + "."))
          .sort()
          .reverse();
        await Promise.all(
          rotated.slice(options.retain).map((f) => unlink(join(dir, f)).catch(() => {}))
        );
      } catch {}

      // Truncate original to reclaim inode while keeping it open for writers
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
