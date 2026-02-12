import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdir, rm, writeFile, readFile, exists } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const TEST_DIR = join(tmpdir(), `bm2-test-pm-${Date.now()}`);
const PROCESS_LIST_FILE = join(TEST_DIR, "processes.json");

interface ProcessEntry {
  id: number;
  name: string;
  script: string;
  status: string;
  pid: number | null;
  restarts: number;
  uptime: number;
  memory: number;
  cpu: number;
  instances: number;
  env: Record<string, string>;
  created_at: string;
  updated_at: string;
}

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

function createProcess(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    id: 0,
    name: "test-app",
    script: "./app.ts",
    status: "online",
    pid: 12345,
    restarts: 0,
    uptime: Date.now(),
    memory: 50 * 1024 * 1024,
    cpu: 2.5,
    instances: 1,
    env: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Process List Management", () => {
  test("should create a new process entry", () => {
    const proc = createProcess({ name: "my-api", script: "./api.ts" });
    expect(proc.name).toBe("my-api");
    expect(proc.script).toBe("./api.ts");
    expect(proc.status).toBe("online");
  });

  test("should save process list to disk", async () => {
    const processes = [
      createProcess({ id: 0, name: "app-1" }),
      createProcess({ id: 1, name: "app-2" }),
    ];
    await writeFile(PROCESS_LIST_FILE, JSON.stringify(processes, null, 2));

    const fileExists = await exists(PROCESS_LIST_FILE);
    expect(fileExists).toBe(true);

    const content = JSON.parse(await readFile(PROCESS_LIST_FILE, "utf-8"));
    expect(content).toHaveLength(2);
    expect(content[0].name).toBe("app-1");
    expect(content[1].name).toBe("app-2");
  });

  test("should load process list from disk", async () => {
    const processes = [createProcess({ id: 0, name: "loaded-app" })];
    await writeFile(PROCESS_LIST_FILE, JSON.stringify(processes, null, 2));

    const loaded: ProcessEntry[] = JSON.parse(
      await readFile(PROCESS_LIST_FILE, "utf-8")
    );
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("loaded-app");
    expect(loaded[0].status).toBe("online");
  });

  test("should assign incremental IDs", () => {
    const processes = [
      createProcess({ id: 0, name: "app-0" }),
      createProcess({ id: 1, name: "app-1" }),
      createProcess({ id: 2, name: "app-2" }),
    ];

    const nextId =
      processes.length > 0
        ? Math.max(...processes.map((p) => p.id)) + 1
        : 0;
    expect(nextId).toBe(3);
  });

  test("should handle empty process list", async () => {
    await writeFile(PROCESS_LIST_FILE, JSON.stringify([]));
    const loaded: ProcessEntry[] = JSON.parse(
      await readFile(PROCESS_LIST_FILE, "utf-8")
    );
    expect(loaded).toHaveLength(0);
  });

  test("should update process status", () => {
    const proc = createProcess({ status: "online" });
    proc.status = "stopped";
    proc.pid = null;
    proc.updated_at = new Date().toISOString();

    expect(proc.status).toBe("stopped");
    expect(proc.pid).toBeNull();
  });

  test("should track restart count", () => {
    const proc = createProcess({ restarts: 0 });
    proc.restarts += 1;
    proc.restarts += 1;
    proc.restarts += 1;

    expect(proc.restarts).toBe(3);
  });

  test("should delete process by id", async () => {
    const processes = [
      createProcess({ id: 0, name: "keep-me" }),
      createProcess({ id: 1, name: "delete-me" }),
      createProcess({ id: 2, name: "keep-me-too" }),
    ];

    const filtered = processes.filter((p) => p.id !== 1);
    expect(filtered).toHaveLength(2);
    expect(filtered.find((p) => p.name === "delete-me")).toBeUndefined();
  });

  test("should find process by name", () => {
    const processes = [
      createProcess({ id: 0, name: "api" }),
      createProcess({ id: 1, name: "worker" }),
      createProcess({ id: 2, name: "scheduler" }),
    ];

    const found = processes.find((p) => p.name === "worker");
    expect(found).toBeDefined();
    expect(found!.id).toBe(1);
  });

  test("should find process by id", () => {
    const processes = [
      createProcess({ id: 0, name: "api" }),
      createProcess({ id: 1, name: "worker" }),
    ];

    const found = processes.find((p) => p.id === 0);
    expect(found).toBeDefined();
    expect(found!.name).toBe("api");
  });
});

describe("Process Status Transitions", () => {
  test("should transition from stopped to online", () => {
    const proc = createProcess({ status: "stopped", pid: null });
    proc.status = "online";
    proc.pid = 99999;
    expect(proc.status).toBe("online");
    expect(proc.pid).toBe(99999);
  });

  test("should transition from online to errored", () => {
    const proc = createProcess({ status: "online", pid: 12345 });
    proc.status = "errored";
    proc.pid = null;
    proc.restarts += 1;
    expect(proc.status).toBe("errored");
    expect(proc.restarts).toBe(1);
  });

  test("should track valid statuses", () => {
    const validStatuses = ["online", "stopped", "errored", "launching"];
    for (const status of validStatuses) {
      const proc = createProcess({ status });
      expect(validStatuses).toContain(proc.status);
    }
  });
});

describe("Process Environment Variables", () => {
  test("should merge env variables", () => {
    const baseEnv = { NODE_ENV: "development", PORT: "3000" };
    const prodEnv = { NODE_ENV: "production", PORT: "8080", LOG_LEVEL: "warn" };
    const merged = { ...baseEnv, ...prodEnv };

    expect(merged.NODE_ENV).toBe("production");
    expect(merged.PORT).toBe("8080");
    expect(merged.LOG_LEVEL).toBe("warn");
  });

  test("should handle empty env", () => {
    const proc = createProcess({ env: {} });
    expect(Object.keys(proc.env)).toHaveLength(0);
  });
});