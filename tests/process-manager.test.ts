import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs"; // Import existsSync from 'fs' instead
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

    // Changed to synchronous check
    const fileExists = existsSync(PROCESS_LIST_FILE);
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

    const first = loaded[0];
    expect(first).toBeDefined();
    expect(first!.name).toBe("loaded-app");
    expect(first!.status).toBe("online");
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

describe("ProcessManager save() and resurrect() Full Configuration Round-Trip", () => {
  test("should preserve complete normalized ProcessDescription across save and resurrect", async () => {
    const { ProcessManager } = await import("../src/process-manager");
    const { DUMP_FILE } = await import("../src/constants");

    const pm = new ProcessManager();
    const scriptPath = join(TEST_DIR, "server.ts");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");

    const started = await pm.start({
      name: "custom-api",
      script: scriptPath,
      cwd: TEST_DIR,
      args: ["--port", "8080"],
      env: { CUSTOM_VAR: "true", NODE_ENV: "production" },
      interpreter: "bun",
      interpreterArgs: ["run"],
      instances: 1,
      execMode: "fork",
      autorestart: true,
      maxRestarts: 25,
      minUptime: 2000,
      restartDelay: 500,
      killTimeout: 4000,
      maxMemoryRestart: "512M",
      watch: ["/some/watch/dir"],
      ignoreWatch: ["node_modules", ".git"],
      cron: "0 0 * * *",
      healthCheckUrl: "http://localhost:8080/health",
      healthCheckInterval: 15000,
      healthCheckTimeout: 3000,
      healthCheckMaxFails: 5,
      logMaxSize: "20M",
      logRetain: 8,
      logCompress: true,
      mergeLogs: false,
      raw: false,
      namespace: "backend",
      port: 8080,
    });

    expect(started).toHaveLength(1);
    const originalProc = started[0]!;

    // Set custom restart counts
    const container = (pm as any).processes.get(originalProc.id);
    container.restartCount = 7;
    container.unstableRestarts = 2;

    // Save to disk
    await pm.save();

    // Verify dump file exists
    const dumpFile = Bun.file(DUMP_FILE);
    expect(await dumpFile.exists()).toBe(true);
    const dumpData = await dumpFile.json();
    expect(dumpData).toHaveLength(1);
    expect(dumpData[0].restartCount).toBe(7);
    expect(dumpData[0].unstableRestarts).toBe(2);

    // Stop and clear all processes to simulate daemon restart
    await pm.deleteAll();
    expect(pm.list()).toHaveLength(0);

    // Resurrect in a new ProcessManager instance
    const newPm = new ProcessManager();
    const resurrected = await newPm.resurrect();

    expect(resurrected).toHaveLength(1);
    const resProc = resurrected[0]!;

    // Verify process identification & counters
    expect(resProc.name).toBe("custom-api");
    expect(resProc.id).toBe(0);
    expect(resProc.bm2_env.restart_time).toBe(7);
    expect(resProc.bm2_env.unstable_restarts).toBe(2);

    // Verify full configuration preservation
    const env = resProc.bm2_env;
    expect(env.interpreter).toBe("bun");
    expect(env.interpreterArgs).toEqual(["run"]);
    expect(env.args).toEqual(["--port", "8080"]);
    expect(env.cwd).toBe(TEST_DIR);
    expect(env.env.CUSTOM_VAR).toBe("true");
    expect(env.env.NODE_ENV).toBe("production");
    expect(env.maxRestarts).toBe(25);
    expect(env.minUptime).toBe(2000);
    expect(env.restartDelay).toBe(500);
    expect(env.killTimeout).toBe(4000);
    expect(env.maxMemoryRestart).toBe(512 * 1024 * 1024);
    expect(env.watch).toBe(true);
    expect(env.watchPaths).toEqual(["/some/watch/dir"]);
    expect(env.ignoreWatch).toEqual(["node_modules", ".git"]);
    expect(env.cronRestart).toBe("0 0 * * *");
    expect(env.healthCheckUrl).toBe("http://localhost:8080/health");
    expect(env.healthCheckInterval).toBe(15000);
    expect(env.healthCheckTimeout).toBe(3000);
    expect(env.healthCheckMaxFails).toBe(5);
    expect(env.logMaxSize).toBe(20 * 1024 * 1024);
    expect(env.logRetain).toBe(8);
    expect(env.logCompress).toBe(true);
    expect(env.namespace).toBe("backend");
    expect(env.port).toBe(8080);

    // Cleanup
    await newPm.deleteAll();
  });

  test("should not duplicate processes when resurrect is called multiple times", async () => {
    const { ProcessManager } = await import("../src/process-manager");
    const pm = new ProcessManager();
    const scriptPath = join(TEST_DIR, "server2.ts");
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");

    await pm.start({ name: "idempotent-app", script: scriptPath });
    await pm.save();

    const firstResurrect = await pm.resurrect();
    expect(firstResurrect).toHaveLength(1);

    const secondResurrect = await pm.resurrect();
    expect(secondResurrect).toHaveLength(1);
    expect(pm.list()).toHaveLength(1);

    await pm.deleteAll();
  });
});

describe("ProcessContainer Restart Budget & minUptime Behavior (Issue #23)", () => {
  test("should exhaust restart budget on rapid crashes below minUptime", async () => {
    const { ProcessManager } = await import("../src/process-manager");
    const pm = new ProcessManager();
    const scriptPath = join(TEST_DIR, "crash-immediately.ts");
    // Process exits immediately
    await writeFile(scriptPath, "process.exit(1);");

    const started = await pm.start({
      name: "crashing-app",
      script: scriptPath,
      minUptime: 200,
      maxRestarts: 3,
      restartDelay: 10,
    });

    const procId = started[0]!.id;
    const container = (pm as any).processes.get(procId);

    // Wait for crashes and restarts to exhaust budget
    await Bun.sleep(250);

    expect(container.unstableRestarts).toBeGreaterThanOrEqual(3);
    expect(container.status).toBe("errored");

    await pm.deleteAll();
  });

  test("should reset unstableRestarts budget when process survives minUptime", async () => {
    const { ProcessManager } = await import("../src/process-manager");
    const pm = new ProcessManager();
    const scriptPath = join(TEST_DIR, "stable-then-exit.ts");
    // A script that stays alive or can be controlled
    await writeFile(scriptPath, "setInterval(() => {}, 1000);");

    const started = await pm.start({
      name: "stable-app",
      script: scriptPath,
      minUptime: 100,
      maxRestarts: 2,
      restartDelay: 10,
    });

    const procId = started[0]!.id;
    const container = (pm as any).processes.get(procId);

    // Simulate an unstable crash (< minUptime)
    container.startedAt = Date.now();
    (container as any).handleExit(1);
    expect(container.unstableRestarts).toBe(1);

    // Wait for restart
    await Bun.sleep(50);
    expect(container.status).toBe("online");

    // Simulate surviving minUptime: set startedAt to 200ms in the past (> 100ms minUptime)
    container.startedAt = Date.now() - 200;
    (container as any).handleExit(1);

    // unstableRestarts should be reset to 0 because uptime >= minUptime
    expect(container.unstableRestarts).toBe(0);

    // Lifetime restartCount should continue accumulating for observability
    expect(container.restartCount).toBeGreaterThanOrEqual(1);

    await pm.deleteAll();
  });
});
