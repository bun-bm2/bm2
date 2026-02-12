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
 
 import { join } from "path";
 
 export class StartupManager {
   async generate(platform?: string): Promise<string> {
     const os = platform || process.platform;
     const bunPath = Bun.which("bun") || "/usr/local/bin/bun";
     const bm2Path = join(import.meta.dir, "index.ts");
     const daemonPath = join(import.meta.dir, "daemon.ts");
 
     switch (os) {
       case "linux":
         return this.generateSystemd(bunPath, bm2Path, daemonPath);
       case "darwin":
         return this.generateLaunchd(bunPath, bm2Path, daemonPath);
       default:
         throw new Error(`Unsupported platform: ${os}`);
     }
   }
 
   private generateSystemd(bunPath: string, bm2Path: string, daemonPath: string): string {
     const unit = `[Unit]
 Description=BM2 Process Manager
 Documentation=https://github.com/bm2
 After=network.target
 
 [Service]
 Type=forking
 User=${process.env.USER || "root"}
 LimitNOFILE=infinity
 LimitNPROC=infinity
 LimitCORE=infinity
 Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:${join(bunPath, "..")}
 Environment=BM2_HOME=${join(process.env.HOME || "/root", ".bm2")}
 PIDFile=${join(process.env.HOME || "/root", ".bm2", "daemon.pid")}
 Restart=on-failure
 
 ExecStart=${bunPath} run ${daemonPath}
 ExecReload=${bunPath} run ${bm2Path} reload all
 ExecStop=${bunPath} run ${bm2Path} kill
 
 [Install]
 WantedBy=multi-user.target`;
 
     const servicePath = "/etc/systemd/system/bm2.service";
     return `# BM2 Systemd Service
 # Save to: ${servicePath}
 # Then run:
 #   sudo systemctl daemon-reload
 #   sudo systemctl enable bm2
 #   sudo systemctl start bm2
 
 ${unit}`;
   }
 
   private generateLaunchd(bunPath: string, bm2Path: string, daemonPath: string): string {
     const plist = `<?xml version="1.0" encoding="UTF-8"?>
 <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
 <plist version="1.0">
 <dict>
     <key>Label</key>
     <string>com.bm2.daemon</string>
     <key>ProgramArguments</key>
     <array>
         <string>${bunPath}</string>
         <string>run</string>
         <string>${daemonPath}</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
     <key>StandardOutPath</key>
     <string>${join(process.env.HOME || "/Users/user", ".bm2", "logs", "daemon-out.log")}</string>
     <key>StandardErrorPath</key>
     <string>${join(process.env.HOME || "/Users/user", ".bm2", "logs", "daemon-error.log")}</string>
     <key>EnvironmentVariables</key>
     <dict>
         <key>PATH</key>
         <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
         <key>HOME</key>
         <string>${process.env.HOME}</string>
     </dict>
 </dict>
 </plist>`;
 
     const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.bm2.daemon.plist`;
     return `# BM2 LaunchAgent (macOS)
 # Save to: ${plistPath}
 # Then run:
 #   launchctl load ${plistPath}
 
 ${plist}`;
   }
 
   async install(): Promise<string> {
     const os = process.platform;
     const content = await this.generate(os);
 
     if (os === "linux") {
       const servicePath = "/etc/systemd/system/bm2.service";
       // Extract just the unit content
       const unitContent = content.split("\n\n").slice(1).join("\n\n");
       await Bun.write(servicePath, unitContent);
 
       Bun.spawn(["sudo", "systemctl", "daemon-reload"], { stdout: "inherit" });
       Bun.spawn(["sudo", "systemctl", "enable", "bm2"], { stdout: "inherit" });
 
       return `Service installed at ${servicePath}\nRun: sudo systemctl start bm2`;
     } else if (os === "darwin") {
       const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.bm2.daemon.plist`;
       // Extract plist content
       const plistStart = content.indexOf("<?xml");
       const plistContent = content.substring(plistStart);
       await Bun.write(plistPath, plistContent);
 
       return `Plist installed at ${plistPath}\nRun: launchctl load ${plistPath}`;
     }
 
     return "Unsupported platform for auto-install. Manual setup required.";
   }
 
   async uninstall(): Promise<string> {
     const os = process.platform;
 
     if (os === "linux") {
       Bun.spawn(["sudo", "systemctl", "stop", "bm2"], { stdout: "inherit" });
       Bun.spawn(["sudo", "systemctl", "disable", "bm2"], { stdout: "inherit" });
       const { unlinkSync } = require("fs");
       try { unlinkSync("/etc/systemd/system/bm2.service"); } catch {}
       Bun.spawn(["sudo", "systemctl", "daemon-reload"], { stdout: "inherit" });
       return "BM2 service removed";
     } else if (os === "darwin") {
       const plistPath = `${process.env.HOME}/Library/LaunchAgents/com.bm2.daemon.plist`;
       Bun.spawn(["launchctl", "unload", plistPath], { stdout: "inherit" });
       const { unlinkSync } = require("fs");
       try { unlinkSync(plistPath); } catch {}
       return "BM2 launch agent removed";
     }
 
     return "Unsupported platform";
   }
 }
