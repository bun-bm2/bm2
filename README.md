# ⚡ BM2

**A blazing-fast, full-featured process manager built entirely on Bun native APIs.**
The modern PM2 replacement — zero Node.js dependencies, pure Bun performance.

![Runtime](https://img.shields.io/badge/runtime-Bun-f472b6?style=flat-square)
![Language](https://img.shields.io/badge/language-TypeScript-3178c6?style=flat-square)
![License](https://img.shields.io/badge/license-GPLv3-green?style=flat-square)
[![Tests](https://github.com/bun-bm2/bm2/actions/workflows/test.yml/badge.svg)](https://github.com/bun-bm2/bm2/actions/workflows/test.yml)

**Created by the MaxxPainn Team**
🌐 [https://maxxpainn.com](https://maxxpainn.com)
📧 Support: [zak@maxxpainn.com](mailto:zak@maxxpainn.com)

---

## Table of Contents

- [Why BM2?](#why-bm2)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
  - [Process Management](#process-management)
  - [Cluster Mode](#cluster-mode)
  - [Log Management](#log-management)
  - [Monitoring and Metrics](#monitoring-and-metrics)
  - [Dashboard](#dashboard)
  - [Ecosystem Files](#ecosystem-files)
  - [Environment Management](#environment-management)
  - [Deployment](#deployment)
  - [Startup Scripts](#startup-scripts)
  - [Modules](#modules)
  - [Daemon Control](#daemon-control)
- [Configuration Reference](#configuration-reference)
  - [Ecosystem File Format](#ecosystem-file-format)
  - [Process Options](#process-options)
  - [Cluster Options](#cluster-options)
  - [Log Options](#log-options)
  - [Health Check Options](#health-check-options)
  - [Watch Options](#watch-options)
  - [Deploy Configuration](#deploy-configuration)
- [Web Dashboard](#web-dashboard)
  - [Dashboard Features](#dashboard-features)
  - [REST API](#rest-api)
  - [WebSocket API](#websocket-api)
- [Prometheus and Grafana Integration](#prometheus-and-grafana-integration)
- [Programmatic API](#programmatic-api)
- [Architecture](#architecture)
- [Comparison with PM2](#comparison-with-pm2)
- [Recipes and Examples](#recipes-and-examples)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)
- [Contributing](#contributing)
- [License](#license)

---

## Why BM2?

PM2 is the de facto process manager for Node.js, but it carries years of legacy baggage, a heavy dependency tree, and is fundamentally built for the Node.js runtime. BM2 is a ground-up reimagining of production process management designed exclusively for the Bun runtime.

BM2 replaces PM2's Node.js internals with Bun-native APIs. It uses `Bun.spawn` for process management, `Bun.serve` for the dashboard and IPC, native `WebSocket` for daemon communication, `Bun.file` for high-performance I/O, and `Bun.gzipSync` for log compression. The result is a process manager that starts faster, uses less memory, and leverages Bun's superior performance across the board.

---

## Features

**Core Process Management** — Start, stop, restart, reload, delete, and scale processes with automatic restart on crash, configurable restart strategies, memory-limit restarts, and tree killing.

**Cluster Mode** — Run multiple instances of your application with per-worker environment injection, automatic port assignment, and round-robin-ready configuration using `NODE_APP_INSTANCE` conventions.

**Zero-Downtime Reload** — Graceful reload cycles through instances sequentially, starting the new process before stopping the old one, ensuring your application never drops a request.

**Real-Time Web Dashboard** — A built-in dark-themed web dashboard with live WebSocket updates, CPU/memory charts, process control buttons, and a log viewer. No external dependencies.

**Prometheus Metrics** — A dedicated metrics endpoint exports process and system telemetry in Prometheus exposition format, ready for scraping by Prometheus and visualization in Grafana.

**Log Management** — Automatic log capture with buffered writes, size-based rotation, configurable retention, optional gzip compression, log flushing, and real-time tailing.

**Health Checks** — HTTP health check probes with configurable intervals, timeouts, and failure thresholds that automatically restart unhealthy processes.

**Cron Restarts** — Schedule periodic restarts using standard cron expressions for applications that benefit from regular recycling.

**File Watching** — Automatic restart on file changes with configurable watch paths and ignore patterns. Ideal for development workflows.

**Ecosystem Files** — Declare your entire application topology in a single JSON or TypeScript configuration file and start everything with one command.

**Process Persistence** — Save the current process list and resurrect it after a daemon restart or system reboot. Combined with startup script generation, your applications survive server reboots.

**Startup Script Generation** — Automatically generate and install systemd (Linux) or launchd (macOS) service configurations so the BM2 daemon starts at boot.

**Remote Deployment** — A built-in deploy system that handles SSH-based deployment with git pull, release directory management, symlink rotation, and pre/post-deploy hooks.

**Module/Plugin System** — Extend BM2 with custom modules that hook into the process manager lifecycle.

**Environment Management** — Store, retrieve, and inject environment variables per process with `.env` file loading support.

**Full IPC Architecture** — A daemonized architecture where the CLI communicates with a long-running daemon process over a Unix domain socket using WebSocket protocol.

---

## Requirements

Bun version 1.0 or higher is required. BM2 is built exclusively for the Bun runtime.

Install Bun if you haven't already:

```
curl -fsSL https://bun.sh/install | bash
```

---

## Installation

### From Source

```
git clone https://github.com/aspect-dev/bm2.git
cd bm2
bun install
bun link
```

### Global Install

```
bun add -g bm2
```

### Verify Installation

```
bm2 --version
```

---

## Quick Start

### Start a process

```
bm2 start app.ts
```

### Start with a name and options

```
bm2 start app.ts --name my-api --instances 4 --port 3000
```

### List all processes

```
bm2 list
```

Output:

```
┌────┬──────────┬──────────┬──────┬───────┬──────────┬──────────┬──────────┐
│ ID │ Name     │ Status   │ PID  │ CPU   │ Memory   │ Restarts │ Uptime   │
├────┼──────────┼──────────┼──────┼───────┼──────────┼──────────┼──────────┤
│ 0  │ my-api-0 │ online   │ 4521 │ 0.3%  │ 42.1 MB  │ 0        │ 5m 23s  │
│ 1  │ my-api-1 │ online   │ 4522 │ 0.2%  │ 39.8 MB  │ 0        │ 5m 23s  │
│ 2  │ my-api-2 │ online   │ 4523 │ 0.4%  │ 41.3 MB  │ 0        │ 5m 23s  │
│ 3  │ my-api-3 │ online   │ 4524 │ 0.1%  │ 40.5 MB  │ 0        │ 5m 23s  │
└────┴──────────┴──────────┴──────┴───────┴──────────┴──────────┴──────────┘
```

### Open the dashboard

```
bm2 dashboard
```

Output:

```
⚡ Dashboard running at http://localhost:9615
📊 Prometheus metrics at http://localhost:9616/metrics
```

### Save and auto-resurrect on reboot

```
bm2 save
bm2 startup
```

---

## CLI Reference

### Process Management

#### bm2 start

Start a new process or processes.

```
bm2 start server.ts
```

```
bm2 start server.ts --name api -- --port 8080 --host 0.0.0.0
```

```
bm2 start server.ts --name api --env NODE_ENV=production --env API_KEY=xxx
```

```
bm2 start server.ts --name api --max-memory-restart 512M
```

```
bm2 start script.py --interpreter python3
```

```
bm2 start server.ts --name api --wait-ready --listen-timeout 10000
```

**Options:**

| Flag | Description | Default |
|---|---|---|
| `--name <name>` | Process name | Script filename |
| `--instances <n>` | Number of instances. Use `max` for all CPUs | `1` |
| `--exec-mode <mode>` | `fork` or `cluster` | `fork` |
| `--cwd <path>` | Working directory | Current directory |
| `--env <KEY=VAL>` | Environment variable (repeatable) | — |
| `--interpreter <bin>` | Custom interpreter binary | Auto-detected |
| `--interpreter-args <args>` | Arguments for the interpreter | — |
| `--node-args <args>` | Additional runtime arguments | — |
| `--max-memory-restart <size>` | Restart when memory exceeds limit | — |
| `--max-restarts <n>` | Maximum consecutive restarts | `16` |
| `--min-uptime <ms>` | Minimum uptime before a restart is considered stable | `1000` |
| `--restart-delay <ms>` | Delay between restarts | `0` |
| `--kill-timeout <ms>` | Grace period before SIGKILL | `5000` |
| `--no-autorestart` | Disable automatic restart | `false` |
| `--cron <expression>` | Cron expression for scheduled restarts | — |
| `--watch` | Enable file watching | `false` |
| `--ignore-watch <dirs>` | Directories to ignore | `node_modules,.git` |
| `--port <n>` | Base port (auto-incremented in cluster mode) | — |
| `--namespace <ns>` | Process namespace for grouping | — |
| `--wait-ready` | Wait for process ready signal | `false` |
| `--listen-timeout <ms>` | Timeout waiting for ready signal | `3000` |
| `--source-map-support` | Enable source map support | `false` |
| `--merge-logs` | Merge all instance logs into one file | `false` |
| `--log-date-format <fmt>` | Date format prefix for log lines | — |
| `--output <file>` | Custom stdout log path | `~/.bm2/logs/<name>-<id>-out.log` |
| `--error <file>` | Custom stderr log path | `~/.bm2/logs/<name>-<id>-error.log` |
| `--log-max-size <size>` | Max log file size before rotation | `10M` |
| `--log-retain <n>` | Number of rotated log files to keep | `5` |
| `--log-compress` | Gzip rotated log files | `false` |
| `--health-check-url <url>` | HTTP endpoint for health probes | — |
| `--health-check-interval <ms>` | Probe interval | `30000` |
| `--health-check-timeout <ms>` | Probe timeout | `5000` |
| `--health-check-max-fails <n>` | Failures before restart | `3` |

---

#### bm2 stop

Stop a process, all processes with a name, or all processes.

```
bm2 stop 0
bm2 stop my-api
bm2 stop my-namespace
bm2 stop all
```

---

#### bm2 restart

Stop and restart a process. The process is fully stopped and then re-spawned.

```
bm2 restart my-api
bm2 restart all
```

---

#### bm2 reload

Graceful zero-downtime reload. New instances start before old ones are killed, ensuring your application always has live workers handling requests.

```
bm2 reload my-api
bm2 reload all
```

The reload process works as follows for each instance. First, a new process is spawned. Then BM2 waits for the new process to become stable or emit a ready signal if `--wait-ready` is enabled. Next, the old process receives SIGTERM and is given the kill timeout to shut down gracefully. Finally, the cycle moves to the next instance.

---

#### bm2 delete

Stop and remove a process from BM2's management.

```
bm2 delete 0
bm2 delete my-api
bm2 delete all
```

---

#### bm2 scale

Dynamically scale a process group up or down.

```
bm2 scale my-api 8
bm2 scale my-api 2
```

When scaling up, new instances inherit the configuration of the existing instances. When scaling down, the highest-numbered instances are stopped and removed first.

---

#### bm2 describe

Show detailed information about a process.

```
bm2 describe my-api
```

Output:

```
┌─────────────────────┬──────────────────────────────────────────┐
│ Name                │ my-api-0                                 │
│ ID                  │ 0                                        │
│ Status              │ online                                   │
│ PID                 │ 4521                                     │
│ Exec Mode           │ cluster                                  │
│ Instances           │ 4                                        │
│ Uptime              │ 2h 15m                                   │
│ Restarts            │ 0                                        │
│ Unstable Restarts   │ 0                                        │
│ CPU                 │ 0.3%                                     │
│ Memory              │ 42.1 MB                                  │
│ File Handles        │ 24                                       │
│ Script              │ /home/user/app/server.ts                 │
│ CWD                 │ /home/user/app                           │
│ Interpreter         │ bun                                      │
│ Watch               │ disabled                                 │
│ Max Memory Restart  │ 512 MB                                   │
│ Health Check        │ http://localhost:3000/health (healthy)    │
│ Cron Restart        │ disabled                                 │
│ Namespace           │ production                               │
│ Created             │ 2025-02-11T10:30:00.000Z                 │
│ Out Log             │ /home/user/.bm2/logs/my-api-0-out.log    │
│ Error Log           │ /home/user/.bm2/logs/my-api-0-error.log  │
└─────────────────────┴──────────────────────────────────────────┘
```

---

#### bm2 list

List all managed processes with their status, resource usage, and uptime.

```
bm2 list
```

---

#### bm2 signal

Send an OS signal to a process.

```
bm2 signal my-api SIGUSR2
```

---

#### bm2 reset

Reset the restart counter for a process.

```
bm2 reset my-api
bm2 reset all
```

---

### Cluster Mode

Cluster mode spawns multiple instances of your application, each running in its own process. This is ideal for CPU-bound workloads and for taking full advantage of multi-core servers.

```
bm2 start server.ts --name api --instances max
```

```
bm2 start server.ts --name api --instances 4
```

```
bm2 start server.ts --name api --instances 4 --port 3000
```

Each cluster worker receives the following environment variables:

| Variable | Description |
|---|---|
| `BM2_CLUSTER` | Set to `"true"` in cluster mode |
| `BM2_WORKER_ID` | Zero-indexed worker ID |
| `BM2_INSTANCES` | Total number of instances |
| `NODE_APP_INSTANCE` | Same as `BM2_WORKER_ID` (PM2 compatibility) |
| `PORT` | `basePort + workerIndex` (if `--port` is specified) |

Example application using cluster-aware port binding:

```
// server.ts
const workerId = parseInt(process.env.BM2_WORKER_ID || "0");
const port = parseInt(process.env.PORT || "3000");

Bun.serve({
  port,
  fetch(req) {
    return new Response(`Hello from worker ${workerId} on port ${port}`);
  },
});

console.log(`Worker ${workerId} listening on :${port}`);
```

---

### Log Management

#### bm2 logs

Display recent logs for a process.

```
bm2 logs
```

```
bm2 logs my-api --lines 100
```

```
bm2 logs my-api --err
```

```
bm2 logs my-api --follow
```

---

#### bm2 flush

Clear log files.

```
bm2 flush my-api
bm2 flush
```

---

#### Log Rotation

Log rotation runs automatically in the background. It checks log file sizes once per minute and rotates when the configured threshold is exceeded.

```
bm2 start server.ts --log-max-size 50M --log-retain 10 --log-compress
```

Rotation behavior: When a log file exceeds `--log-max-size`, it is renamed with a numeric suffix. Existing rotated files are shifted up by one number. Files beyond the `--log-retain` count are deleted. If `--log-compress` is enabled, rotated files are gzip-compressed using Bun's native `Bun.gzipSync`.

Default values:

| Setting | Default |
|---|---|
| `log-max-size` | `10 MB` |
| `log-retain` | `5` |
| `log-compress` | `false` |

---

### Monitoring and Metrics

#### bm2 monit

Open an interactive terminal monitor showing real-time CPU, memory, and event loop data for all processes.

```
bm2 monit
```

---

#### bm2 metrics

Dump a current metrics snapshot as JSON.

```
bm2 metrics
```

Output:

```
{
  "timestamp": 1707650400000,
  "processes": [
    {
      "id": 0,
      "name": "my-api-0",
      "pid": 4521,
      "cpu": 0.3,
      "memory": 44150784,
      "handles": 24,
      "status": "online",
      "restarts": 0,
      "uptime": 8100000
    }
  ],
  "system": {
    "totalMemory": 17179869184,
    "freeMemory": 8589934592,
    "cpuCount": 8,
    "loadAvg": [1.23, 1.45, 1.67],
    "platform": "linux"
  }
}
```

---

#### bm2 metrics --history

Retrieve historical metrics. BM2 retains up to 1 hour of per-second snapshots in memory.

```
bm2 metrics --history 600
```

---

#### bm2 prometheus

Output current metrics in Prometheus exposition format.

```
bm2 prometheus
```

Output:

```
# HELP bm2_process_cpu CPU usage percentage
# TYPE bm2_process_cpu gauge
bm2_process_cpu{name="my-api-0",id="0"} 0.3
# HELP bm2_process_memory_bytes Memory usage in bytes
# TYPE bm2_process_memory_bytes gauge
bm2_process_memory_bytes{name="my-api-0",id="0"} 44150784
# HELP bm2_process_restarts_total Total restart count
# TYPE bm2_process_restarts_total counter
bm2_process_restarts_total{name="my-api-0",id="0"} 0
# HELP bm2_process_uptime_seconds Process uptime in seconds
# TYPE bm2_process_uptime_seconds gauge
bm2_process_uptime_seconds{name="my-api-0",id="0"} 8100
# HELP bm2_process_status Process status (1=online)
# TYPE bm2_process_status gauge
bm2_process_status{name="my-api-0",id="0",status="online"} 1
# HELP bm2_system_memory_total_bytes Total system memory
# TYPE bm2_system_memory_total_bytes gauge
bm2_system_memory_total_bytes 17179869184
# HELP bm2_system_memory_free_bytes Free system memory
# TYPE bm2_system_memory_free_bytes gauge
bm2_system_memory_free_bytes 8589934592
# HELP bm2_system_load_average System load average
# TYPE bm2_system_load_average gauge
bm2_system_load_average{period="1m"} 1.23
bm2_system_load_average{period="5m"} 1.45
bm2_system_load_average{period="15m"} 1.67
```

---

### Dashboard

#### bm2 dashboard

Launch the built-in web dashboard.

```
bm2 dashboard
```

```
bm2 dashboard --port 8080 --metrics-port 8081
```

#### bm2 dashboard stop

Stop the web dashboard.

```
bm2 dashboard stop
```

See the Web Dashboard section below for a detailed description of dashboard capabilities.

---

### Ecosystem Files

An ecosystem file defines your entire application topology in a single configuration. BM2 supports JSON and TypeScript ecosystem files.

```
bm2 start ecosystem.config.json
```

```
bm2 start ecosystem.config.ts
```

Example `ecosystem.config.json`:

```
{
  "apps": [
    {
      "name": "api",
      "script": "./src/api/server.ts",
      "instances": 4,
      "execMode": "cluster",
      "port": 3000,
      "env": {
        "NODE_ENV": "production",
        "DATABASE_URL": "postgres://localhost/mydb"
      },
      "maxMemoryRestart": "512M",
      "healthCheckUrl": "http://localhost:3000/health",
      "healthCheckInterval": 15000,
      "logMaxSize": "50M",
      "logRetain": 10,
      "logCompress": true
    },
    {
      "name": "worker",
      "script": "./src/worker/index.ts",
      "instances": 2,
      "env": {
        "NODE_ENV": "production",
        "REDIS_URL": "redis://localhost:6379"
      },
      "cron": "0 */6 * * *",
      "maxRestarts": 50
    },
    {
      "name": "scheduler",
      "script": "./src/scheduler/cron.ts",
      "instances": 1,
      "autorestart": true,
      "watch": ["./src/scheduler"]
    }
  ],
  "deploy": {
    "production": {
      "user": "deploy",
      "host": ["web1.example.com", "web2.example.com"],
      "ref": "origin/main",
      "repo": "git@github.com:your-org/your-app.git",
      "path": "/var/www/app",
      "preDeploy": "bun test",
      "postDeploy": "bun install && bm2 reload ecosystem.config.json --env production"
    }
  }
}
```

Example `ecosystem.config.ts`:

```
// ecosystem.config.ts
import type { EcosystemConfig } from "bm2/types";

const config: EcosystemConfig = {
  apps: [
    {
      name: "api",
      script: "./src/server.ts",
      instances: "max",
      execMode: "cluster",
      port: 3000,
      env: {
        NODE_ENV: "production",
      },
      maxMemoryRestart: "1G",
      healthCheckUrl: "http://localhost:3000/health",
    },
  ],
};

export default config;
```

---

### Environment Management

#### bm2 env set

Set an environment variable for a process.

```
bm2 env set my-api DATABASE_URL postgres://localhost/mydb
```

#### bm2 env get

List all stored environment variables for a process.

```
bm2 env get my-api
```

#### bm2 env delete

Remove an environment variable or all environment variables.

```
bm2 env delete my-api DATABASE_URL
bm2 env delete my-api
```

#### .env File Support

BM2 can load environment variables from `.env` files:

```
bm2 start server.ts --env-file .env.production
```

---

### Deployment

BM2 includes a built-in deployment system for SSH-based deployments with release management.

#### bm2 deploy setup

Initial setup of the remote server. Creates the directory structure and clones the repository.

```
bm2 deploy ecosystem.config.json production setup
```

This creates the following remote directory structure:

```
/var/www/app/
├── source/
├── releases/
│   ├── 2025-02-11T10-30-00-000Z/
│   └── 2025-02-10T15-45-00-000Z/
├── current -> releases/2025-02-11T10-30-00-000Z/
└── shared/
```

#### bm2 deploy

Deploy a new release.

```
bm2 deploy ecosystem.config.json production
```

The deploy process works as follows. It runs the `preDeploy` hook locally such as running tests. It connects via SSH to each configured host. It pulls the latest code from the configured ref. It creates a new timestamped release directory. It updates the current symlink to the new release. It runs the `postDeploy` hook remotely such as installing dependencies and reloading processes. It cleans up old releases, keeping only the 5 most recent.

Multi-host deployment is supported. Specify an array of hosts to deploy to all of them sequentially:

```
{
  "host": ["web1.example.com", "web2.example.com", "web3.example.com"]
}
```

---

### Startup Scripts

#### bm2 startup

Generate and display a startup script for your operating system. On Linux, this generates a systemd unit file. On macOS, this generates a launchd plist.

```
bm2 startup
```

#### bm2 startup install

Automatically install the startup script so the BM2 daemon starts at boot.

```
bm2 startup install
```

#### bm2 startup uninstall

Remove the startup script.

```
bm2 startup uninstall
```

#### bm2 save

Save the current process list so it can be restored on daemon startup.

```
bm2 save
```

#### bm2 resurrect

Restore previously saved processes.

```
bm2 resurrect
```

Recommended boot setup:

```
bm2 start ecosystem.config.json
bm2 save
bm2 startup install
```

On reboot, systemd or launchd starts the BM2 daemon, and the daemon automatically runs resurrect to restore your processes.

---

### Modules

BM2 supports a plugin system for extending functionality.

#### bm2 module install

Install a module from a git URL, local path, or npm package name.

```
bm2 module install https://github.com/user/bm2-logrotate.git
bm2 module install ./my-bm2-module
bm2 module install bm2-prometheus-pushgateway
```

#### bm2 module list

List installed modules.

```
bm2 module list
```

#### bm2 module uninstall

Remove an installed module.

```
bm2 module uninstall bm2-prometheus-pushgateway
```

#### Writing a BM2 Module

A BM2 module is a package with a default export implementing the BM2Module interface:

```
// my-module/index.ts
import type { ProcessManager } from "bm2/process-manager";

export default {
  name: "my-module",
  version: "1.0.0",

  init(pm: ProcessManager) {
    console.log("[my-module] Initialized with", pm.list().length, "processes");
  },

  destroy() {
    console.log("[my-module] Destroyed");
  },
};
```

---

### Daemon Control

#### bm2 ping

Check if the daemon is running.

```
bm2 ping
```

#### bm2 kill

Stop all processes and kill the daemon.

```
bm2 kill
```

---

## Configuration Reference

### Ecosystem File Format

The ecosystem file is a JSON or TypeScript file with the following top-level structure:

```
interface EcosystemConfig {
  apps: StartOptions[];
  deploy?: Record<string, DeployConfig>;
}
```

---

### Process Options

The complete set of options available for each entry in the apps array:

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | Filename | Process name |
| `script` | `string` | required | Path to the script to execute |
| `args` | `string[]` | `[]` | Arguments passed to the script |
| `cwd` | `string` | `process.cwd()` | Working directory |
| `env` | `Record<string, string>` | `{}` | Environment variables |
| `instances` | `number` or `"max"` | `1` | Number of instances |
| `execMode` | `"fork"` or `"cluster"` | `"fork"` | Execution mode |
| `autorestart` | `boolean` | `true` | Restart on crash |
| `maxRestarts` | `number` | `16` | Maximum restart attempts before giving up |
| `minUptime` | `number` | `1000` | Minimum ms a process must be up to be considered stable |
| `maxMemoryRestart` | `string` or `number` | — | Memory threshold for restart |
| `restartDelay` | `number` | `0` | Delay in ms between restart attempts |
| `killTimeout` | `number` | `5000` | Grace period in ms before SIGKILL |
| `interpreter` | `string` | Auto | Custom interpreter |
| `interpreterArgs` | `string[]` | — | Arguments for the interpreter |
| `nodeArgs` | `string[]` | — | Additional runtime arguments |
| `namespace` | `string` | — | Namespace for grouping processes |
| `sourceMapSupport` | `boolean` | `false` | Enable source map support |
| `waitReady` | `boolean` | `false` | Wait for process to emit ready signal |
| `listenTimeout` | `number` | `3000` | Timeout when waiting for ready signal |

---

### Cluster Options

| Option | Type | Default | Description |
|---|---|---|---|
| `instances` | `number` or `"max"` | `1` | Worker count |
| `execMode` | `"cluster"` | `"fork"` | Set to cluster for multi-instance mode |
| `port` | `number` | — | Base port. Worker i gets port + i |

---

### Log Options

| Option | Type | Default | Description |
|---|---|---|---|
| `outFile` | `string` | `~/.bm2/logs/<name>-<id>-out.log` | Custom stdout log path |
| `errorFile` | `string` | `~/.bm2/logs/<name>-<id>-error.log` | Custom stderr log path |
| `mergeLogs` | `boolean` | `false` | Merge all instance logs into one file |
| `logDateFormat` | `string` | — | Date format for log line prefixes |
| `logMaxSize` | `string` or `number` | `"10M"` | Max log file size before rotation |
| `logRetain` | `number` | `5` | Number of rotated files to keep |
| `logCompress` | `boolean` | `false` | Gzip-compress rotated log files |

---

### Health Check Options

| Option | Type | Default | Description |
|---|---|---|---|
| `healthCheckUrl` | `string` | — | URL to probe |
| `healthCheckInterval` | `number` | `30000` | Probe interval in ms |
| `healthCheckTimeout` | `number` | `5000` | Probe timeout in ms |
| `healthCheckMaxFails` | `number` | `3` | Consecutive failures before restart |

---

### Watch Options

| Option | Type | Default | Description |
|---|---|---|---|
| `watch` | `boolean` or `string[]` | `false` | Enable file watching |
| `ignoreWatch` | `string[]` | `["node_modules", ".git", ".bm2"]` | Patterns to ignore |

---

### Deploy Configuration

| Option | Type | Description |
|---|---|---|
| `user` | `string` | SSH user |
| `host` | `string` or `string[]` | Remote host(s) |
| `ref` | `string` | Git ref to deploy |
| `repo` | `string` | Git repository URL |
| `path` | `string` | Remote deployment path |
| `preDeploy` | `string` | Command to run locally before deploy |
| `postDeploy` | `string` | Command to run remotely after deploy |
| `preSetup` | `string` | Command to run remotely during setup |
| `postSetup` | `string` | Command to run remotely after setup |
| `ssh_options` | `string` | Additional SSH options |
| `env` | `Record<string, string>` | Environment variables for remote commands |

---

## Web Dashboard

The BM2 dashboard is a self-contained web application served directly by the daemon. It requires no external dependencies. The HTML, CSS, JavaScript, and WebSocket server are all built in.

### Dashboard Features

**Process Overview** — Four summary cards showing counts of online and errored processes, total CPU usage, and aggregate memory consumption.

**System Information** — Platform, CPU count, load average, and memory usage with a visual progress bar.

**CPU and Memory Chart** — A real-time canvas-rendered chart showing aggregate CPU percentage and memory usage over the last 60 data points, updating every 2 seconds.

**Process Table** — A detailed table showing every managed process with columns for ID, name, status with color-coded badges, PID, CPU, memory, restart count, uptime, and action buttons for restart, stop, and log viewing.

**Log Viewer** — A tabbed log panel that streams stdout and stderr from any selected process, with syntax highlighting for timestamps and error output. Logs auto-scroll to the latest entry.

**Live Updates** — All data is streamed over WebSocket with a visual pulse indicator confirming the live connection. If the connection drops, the dashboard automatically reconnects within 2 seconds.

---

### REST API

The dashboard exposes a REST API on the same port:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Dashboard HTML |
| `GET` | `/api/processes` | List all processes as JSON |
| `GET` | `/api/metrics` | Current metrics snapshot |
| `GET` | `/api/metrics/history?seconds=300` | Historical metrics |
| `GET` | `/api/prometheus` or `/metrics` | Prometheus text format |
| `POST` | `/api/restart` | Restart process |
| `POST` | `/api/stop` | Stop process |
| `POST` | `/api/reload` | Graceful reload |
| `POST` | `/api/delete` | Delete process |
| `POST` | `/api/scale` | Scale process |
| `POST` | `/api/flush` | Flush logs |

POST endpoints accept JSON body with `target` field for process identification and additional fields where applicable such as `count` for scaling.

Example using curl:

```
curl http://localhost:9615/api/processes
```

```
curl -X POST http://localhost:9615/api/restart \
  -H "Content-Type: application/json" \
  -d '{"target": "my-api"}'
```

```
curl -X POST http://localhost:9615/api/scale \
  -H "Content-Type: application/json" \
  -d '{"target": "my-api", "count": 8}'
```

```
curl http://localhost:9615/metrics
```

---

### WebSocket API

Connect to `ws://localhost:9615/ws` for real-time bidirectional communication.

Client to server messages:

```
{ "type": "getState", "data": {} }
```

```
{ "type": "getLogs", "data": { "target": 0, "lines": 50 } }
```

```
{ "type": "restart", "data": { "target": "my-api" } }
```

```
{ "type": "stop", "data": { "target": 0 } }
```

```
{ "type": "reload", "data": { "target": "all" } }
```

```
{ "type": "scale", "data": { "target": "my-api", "count": 4 } }
```

Server to client messages:

```
{
  "type": "state",
  "data": {
    "processes": [],
    "metrics": {
      "timestamp": 1707650400000,
      "processes": [],
      "system": {}
    }
  }
}
```

```
{
  "type": "logs",
  "data": [
    { "name": "my-api-0", "id": 0, "out": "...", "err": "..." }
  ]
}
```

---

## Prometheus and Grafana Integration

BM2 runs a dedicated Prometheus metrics server on default port 9616 separately from the dashboard, following best practices for metrics collection.

### Prometheus Configuration

Add the following to your `prometheus.yml`:

```
scrape_configs:
  - job_name: "bm2"
    scrape_interval: 5s
    static_configs:
      - targets: ["localhost:9616"]
```

### Available Metrics

| Metric | Type | Labels | Description |
|---|---|---|---|
| `bm2_process_cpu` | gauge | `name`, `id` | CPU usage percentage |
| `bm2_process_memory_bytes` | gauge | `name`, `id` | Memory usage in bytes |
| `bm2_process_restarts_total` | counter | `name`, `id` | Total restart count |
| `bm2_process_uptime_seconds` | gauge | `name`, `id` | Uptime in seconds |
| `bm2_process_status` | gauge | `name`, `id`, `status` | 1 if online, 0 otherwise |
| `bm2_system_memory_total_bytes` | gauge | — | Total system memory |
| `bm2_system_memory_free_bytes` | gauge | — | Free system memory |
| `bm2_system_load_average` | gauge | `period` | Load average (1m, 5m, 15m) |

### Grafana Dashboard

Import a dashboard with the following panels for comprehensive monitoring: Process Status Overview as a stat panel colored by status, CPU Usage per Process as a time series with `bm2_process_cpu` grouped by name, Memory Usage per Process as a time series with `bm2_process_memory_bytes` grouped by name, Restart Rate as a graph of `rate(bm2_process_restarts_total[5m])` to detect instability, System Load as a time series of `bm2_system_load_average` across all periods, and Memory Pressure as a gauge computing `1 - (bm2_system_memory_free_bytes / bm2_system_memory_total_bytes)`.

### Alert Rules Example

```
groups:
  - name: bm2
    rules:
      - alert: ProcessDown
        expr: bm2_process_status == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Process {{ \$labels.name }} is down"

      - alert: HighRestartRate
        expr: rate(bm2_process_restarts_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Process {{ \$labels.name }} is restarting frequently"

      - alert: HighMemoryUsage
        expr: bm2_process_memory_bytes > 1e9
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Process {{ \$labels.name }} using > 1GB memory"
```

---

## Programmatic API

BM2 can be used as a library in your own Bun applications:

```
// app.ts
import { ProcessManager } from "bm2/process-manager";
import { Dashboard } from "bm2/dashboard";

const pm = new ProcessManager();

// Start a process
const states = await pm.start({
  name: "my-api",
  script: "./server.ts",
  instances: 4,
  execMode: "cluster",
  port: 3000,
  env: { NODE_ENV: "production" },
  maxMemoryRestart: "512M",
  healthCheckUrl: "http://localhost:3000/health",
});

console.log("Started:", states.map((s) => `${s.name} (pid: ${s.pid})`));

// List processes
const list = pm.list();

// Get metrics
const metrics = await pm.getMetrics();

// Scale
await pm.scale("my-api", 8);

// Graceful reload
await pm.reload("my-api");

// Start the web dashboard
const dashboard = new Dashboard(pm);
dashboard.start(9615, 9616);

// Get Prometheus-format metrics
const promText = pm.getPrometheusMetrics();

// Save and restore
await pm.save();
await pm.resurrect();

// Stop everything
await pm.stopAll();
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      BM2 CLI                            │
│  (bm2 start, bm2 list, bm2 restart, bm2 dashboard)    │
└────────────────────────┬────────────────────────────────┘
                         │ Unix Socket (WebSocket)
                         │ ~/.bm2/daemon.sock
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    BM2 Daemon                           │
│                                                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────┐  │
│  │ Process Manager  │  │   Dashboard  │  │  Modules  │  │
│  │                 │  │  (Bun.serve) │  │  (Plugins)│  │
│  │  ┌───────────┐  │  │  HTTP + WS   │  └───────────┘  │
│  │  │ Container │  │  │  REST API    │                  │
│  │  │ (Bun.spawn)│  │  └──────────────┘                 │
│  │  └───────────┘  │                                    │
│  │  ┌───────────┐  │  ┌──────────────┐  ┌───────────┐  │
│  │  │ Container │  │  │   Monitor    │  │  Metrics  │  │
│  │  │ (Bun.spawn)│  │  │  CPU/Memory │  │ Prometheus│  │
│  │  └───────────┘  │  └──────────────┘  │  :9616    │  │
│  │  ┌───────────┐  │                    └───────────┘  │
│  │  │ Container │  │  ┌──────────────┐                  │
│  │  │ (Bun.spawn)│  │  │ Health Check │                 │
│  │  └───────────┘  │  │  HTTP Probes │                  │
│  └─────────────────┘  └──────────────┘                  │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ ┌─────────────┐  │
│  │  Cluster │ │   Logs   │ │  Cron  │ │   Deploy    │  │
│  │  Manager │ │ Manager  │ │Manager │ │   Manager   │  │
│  └──────────┘ └──────────┘ └────────┘ └─────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Daemon Process** — The daemon is a long-running Bun process that manages all child processes. It listens on a Unix domain socket at `~/.bm2/daemon.sock` for commands from the CLI. The daemon is automatically started when you first run a BM2 command and can be explicitly killed with `bm2 kill`.

**Process Container** — Each managed process is wrapped in a ProcessContainer that handles spawning via `Bun.spawn`, log piping, monitoring, restart logic, health checking, watch mode, and signal handling.

**IPC Protocol** — The CLI and daemon communicate over WebSocket on a Unix socket. Messages are JSON-encoded with a `type` field for routing and an `id` field for request-response correlation.

**Dashboard** — The dashboard is served by a `Bun.serve` instance with WebSocket upgrade support. A single HTTP server handles the dashboard UI, REST API, and WebSocket connections.

**Metrics Server** — A separate `Bun.serve` instance on port 9616 serves Prometheus metrics, keeping the scrape endpoint isolated from dashboard traffic.

---

## Comparison with PM2

| Feature | PM2 | BM2 |
|---|---|---|
| Runtime | Node.js | Bun |
| Language | JavaScript | TypeScript |
| Dependencies | ~40+ packages | Zero (Bun built-ins only) |
| Process Spawning | `child_process.fork` | `Bun.spawn` |
| IPC | Custom protocol over pipes | WebSocket over Unix socket |
| HTTP Server | Express/http | `Bun.serve` |
| Log Compression | External `pm2-logrotate` module | Built-in `Bun.gzipSync` |
| Dashboard | PM2 Plus (paid) or `pm2-monit` | Built-in web dashboard (free) |
| Prometheus Metrics | `pm2-prometheus-exporter` module | Built-in native export |
| Startup Time | ~500ms | ~50ms |
| Memory Overhead | ~40MB (daemon) | ~12MB (daemon) |
| Cluster Mode | `cluster` module | `Bun.spawn` with env-based routing |
| Ecosystem Files | JSON, JS, YAML | JSON, TypeScript |
| Deploy System | Built-in | Built-in |
| Module System | `pm2 install` | `bm2 module install` |
| TypeScript | Requires compilation | Native support |
| File Watching | `chokidar` | Native `fs.watch` |

---

## Recipes and Examples

### Basic HTTP Server

```
bm2 start server.ts --name api
```

### Production API with Clustering and Health Checks

```
bm2 start server.ts \
  --name api \
  --instances max \
  --port 3000 \
  --max-memory-restart 512M \
  --health-check-url http://localhost:3000/health \
  --health-check-interval 15000 \
  --log-max-size 50M \
  --log-retain 10 \
  --log-compress
```

### Development Mode with Watch

```
bm2 start server.ts --name dev-api --watch --ignore-watch node_modules,.git,dist
```

### Python Script

```
bm2 start worker.py --name py-worker --interpreter python3
```

### Scheduled Restart (Daily at 3 AM)

```
bm2 start server.ts --name api --cron "0 3 * * *"
```

### Multiple Environments via Ecosystem

```
{
  "apps": [
    {
      "name": "api-staging",
      "script": "./server.ts",
      "env": { "NODE_ENV": "staging", "PORT": "3000" }
    },
    {
      "name": "api-production",
      "script": "./server.ts",
      "env": { "NODE_ENV": "production", "PORT": "8080" }
    }
  ]
}
```

### Full Production Setup

```
bm2 start ecosystem.config.json
bm2 save
bm2 startup install
bm2 dashboard
bm2 list
```

### Monitoring with Prometheus and Grafana

```
bm2 dashboard --metrics-port 9616
curl http://localhost:9616/metrics
```

Then add the target to your `prometheus.yml` and import the Grafana dashboard.

### Zero-Downtime Deploy

```
bm2 deploy ecosystem.config.json production
```

Or manually:

```
git pull origin main
bun install
bm2 reload all
```

---

## Troubleshooting

### Daemon won't start

If BM2 commands hang or return connection errors, the daemon may have died without cleanup.

```
rm -f ~/.bm2/daemon.sock ~/.bm2/daemon.pid
bm2 list
```

### Process keeps restarting

Check the error logs for crash information:

```
bm2 logs my-app --err --lines 100
```

If the process exits too quickly, it may hit the max restart limit. Check `minUptime` and `maxRestarts` settings:

```
bm2 describe my-app
```

Reset the counter if needed:

```
bm2 reset my-app
```

### High memory usage

If a process is using excessive memory and you have `maxMemoryRestart` configured, BM2 will restart it automatically. You can also check the metrics history:

```
bm2 metrics --history 3600
```

### Port conflicts

In cluster mode, each instance uses `basePort + instanceIndex`. Ensure no other services are using those ports:

```
lsof -i :3000-3007
```

### Log files growing too large

Enable log rotation:

```
bm2 start server.ts --log-max-size 50M --log-retain 5 --log-compress
```

Or flush existing logs:

```
bm2 flush my-app
```

### Dashboard not accessible

Ensure the dashboard is started and check the port:

```
bm2 dashboard --port 9615
curl http://localhost:9615
```

If running behind a firewall, ensure port 9615 (dashboard) and 9616 (metrics) are open.

### Checking daemon health

```
bm2 ping
```

This returns the daemon PID and uptime. If it doesn't respond, the daemon needs to be restarted.

---

## File Structure

BM2 stores all data in `~/.bm2/`:

```
~/.bm2/
├── daemon.sock          # Unix domain socket for IPC
├── daemon.pid           # Daemon process ID
├── dump.json            # Saved process list (bm2 save)
├── config.json          # Global configuration
├── env-registry.json    # Stored environment variables
├── logs/                # Process log files
│   ├── my-api-0-out.log
│   ├── my-api-0-error.log
│   ├── my-api-0-out.log.1.gz
│   └── daemon-out.log
├── pids/                # PID files
│   └── my-api-0.pid
├── metrics/             # Persisted metric snapshots
└── modules/             # Installed BM2 modules
```

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository and create a feature branch.
2. Write tests for new functionality.
3. Follow the existing code style — TypeScript strict mode, no `any` where avoidable.
4. Run the test suite before submitting: `bun test`.
5. Submit a pull request with a clear description of the change.

### Development Setup

```
git clone https://github.com/aspect-dev/bm2.git
cd bm2
bun install
bun run src/index.ts list
bun test
```

---

## License

GPL-3.0-only

Copyright (c) 2025 MaxxPainn Team

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

**Built with ❤️ by the [MaxxPainn Team](https://maxxpainn.com)**
📧 Support: [zak@maxxpainn.com](mailto:zak@maxxpainn.com)
