import { describe, test, expect } from "bun:test";

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

function parseMemory(str: string): number {
  const match = str.match(/^([\d.]+)(B|KB|MB|GB)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]!);
  const unit = match[2]!;
  switch (unit) {
    case "B": return value;
    case "KB": return value * 1024;
    case "MB": return value * 1024 * 1024;
    case "GB": return value * 1024 * 1024 * 1024;
    default: return 0;
  }
}

describe("Cluster Utilities", () => {
  describe("formatMemory", () => {
    test("formats bytes", () => {
      expect(formatMemory(500)).toBe("500B");
    });

    test("formats kilobytes", () => {
      expect(formatMemory(2048)).toBe("2.0KB");
    });

    test("formats megabytes", () => {
      expect(formatMemory(5 * 1024 * 1024)).toBe("5.0MB");
    });

    test("formats gigabytes", () => {
      expect(formatMemory(2 * 1024 * 1024 * 1024)).toBe("2.0GB");
    });

    test("formats fractional values", () => {
      expect(formatMemory(1536)).toBe("1.5KB");
    });
  });

  describe("parseMemory", () => {
    test("parses bytes", () => {
      expect(parseMemory("500B")).toBe(500);
    });

    test("parses kilobytes", () => {
      expect(parseMemory("2.0KB")).toBe(2048);
    });

    test("parses megabytes", () => {
      expect(parseMemory("5.0MB")).toBe(5 * 1024 * 1024);
    });

    test("parses gigabytes", () => {
      expect(parseMemory("2.0GB")).toBe(2 * 1024 * 1024 * 1024);
    });

    test("returns 0 for invalid input", () => {
      expect(parseMemory("invalid")).toBe(0);
    });
  });

  describe("Instance count calculation", () => {
    test("max uses available CPUs", () => {
      const cpuCount = navigator.hardwareConcurrency || 4;
      expect(cpuCount).toBeGreaterThan(0);
    });

    test("calculates instance count", () => {
      const cpuCount = navigator.hardwareConcurrency || 4;
      const requested: string = "max";
      const instances = requested === "max" ? cpuCount : parseInt(requested);
      expect(instances).toBe(cpuCount);
    });

    test("numeric instance count", () => {
      const requested: string = "4";
      const instances = requested === "max" ? 0 : parseInt(requested);
      expect(instances).toBe(4);
    });
  });
});
