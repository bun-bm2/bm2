import { describe, test, expect } from "bun:test";

interface ClusterConfig {
  instances: number | "max";
  max_memory_restart?: string;
  kill_timeout?: number;
  listen_timeout?: number;
  restart_delay?: number;
  max_restarts?: number;
  autorestart?: boolean;
}

function resolveInstances(value: number | "max"): number {
  if (value === "max") {
    return navigator.hardwareConcurrency || 1;
  }
  return Math.max(1, Math.floor(value));
}

function parseMemoryLimit(limit: string): number | null {
  const match = limit.match(/^(\d+(?:\.\d+)?)\s*(K|M|G)?$/i);
  if (!match) return null;

  const value = parseFloat(match[1]);
  const unit = (match[2] || "").toUpperCase();

  switch (unit) {
    case "K":
      return value * 1024;
    case "M":
      return value * 1024 * 1024;
    case "G":
      return value * 1024 * 1024 * 1024;
    case "":
      return value;
    default:
      return null;
  }
}

function shouldRestartWorker(
  restarts: number,
  maxRestarts: number,
  autorestart: boolean
): boolean {
  if (!autorestart) return false;
  return restarts < maxRestarts;
}

describe("Cluster Instance Resolution", () => {
  test("should resolve 'max' to CPU count", () => {
    const count = resolveInstances("max");
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBe(navigator.hardwareConcurrency || 1);
  });

  test("should resolve numeric instances", () => {
    expect(resolveInstances(4)).toBe(4);
    expect(resolveInstances(1)).toBe(1);
    expect(resolveInstances(16)).toBe(16);
  });

  test("should enforce minimum of 1 instance", () => {
    expect(resolveInstances(0)).toBe(1);
    expect(resolveInstances(-5)).toBe(1);
  });

  test("should floor fractional instances", () => {
    expect(resolveInstances(2.7)).toBe(2);
    expect(resolveInstances(3.9)).toBe(3);
  });
});

describe("Memory Limit Parsing", () => {
  test("should parse megabytes", () => {
    expect(parseMemoryLimit("200M")).toBe(200 * 1024 * 1024);
  });

  test("should parse gigabytes", () => {
    expect(parseMemoryLimit("1G")).toBe(1024 * 1024 * 1024);
  });

  test("should parse kilobytes", () => {
    expect(parseMemoryLimit("512K")).toBe(512 * 1024);
  });

  test("should parse raw bytes (no unit)", () => {
    expect(parseMemoryLimit("104857600")).toBe(104857600);
  });

  test("should be case insensitive", () => {
    expect(parseMemoryLimit("200m")).toBe(200 * 1024 * 1024);
    expect(parseMemoryLimit("1g")).toBe(1024 * 1024 * 1024);
  });

  test("should parse decimal values", () => {
    expect(parseMemoryLimit("1.5G")).toBe(1.5 * 1024 * 1024 * 1024);
  });

  test("should return null for invalid format", () => {
    expect(parseMemoryLimit("abc")).toBeNull();
    expect(parseMemoryLimit("")).toBeNull();
    expect(parseMemoryLimit("200X")).toBeNull();
  });
});

describe("Worker Restart Logic", () => {
  test("should allow restart when under max restarts", () => {
    expect(shouldRestartWorker(0, 10, true)).toBe(true);
    expect(shouldRestartWorker(5, 10, true)).toBe(true);
    expect(shouldRestartWorker(9, 10, true)).toBe(true);
  });

  test("should deny restart when at or over max restarts", () => {
    expect(shouldRestartWorker(10, 10, true)).toBe(false);
    expect(shouldRestartWorker(15, 10, true)).toBe(false);
  });

  test("should deny restart when autorestart is disabled", () => {
    expect(shouldRestartWorker(0, 10, false)).toBe(false);
    expect(shouldRestartWorker(5, 10, false)).toBe(false);
  });

  test("should handle max_restarts of 0", () => {
    expect(shouldRestartWorker(0, 0, true)).toBe(false);
  });
});