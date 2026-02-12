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
 import type { DeployConfig } from "./types";
 
 export class DeployManager {
   async deploy(config: DeployConfig, command?: string): Promise<void> {
     const hosts = Array.isArray(config.host) ? config.host : [config.host];
     const sshOpts = config.ssh_options || "";
 
     for (const host of hosts) {
       const target = `${config.user}@${host}`;
       console.log(`\n[bm2] Deploying to ${target}...`);
 
       const remotePath = config.path;
       const currentPath = `${remotePath}/current`;
       const sourcePath = `${remotePath}/source`;
 
       // Pre-deploy hook
       if (config.preDeploy) {
         console.log(`[bm2] Running pre-deploy: ${config.preDeploy}`);
         await this.localExec(config.preDeploy);
       }
 
       // Setup directory structure
       await this.remoteExec(
         target,
         `mkdir -p ${remotePath} ${sourcePath}`,
         sshOpts
       );
 
       // Clone or pull
       const hasRepo = await this.remoteExec(
         target,
         `test -d ${sourcePath}/.git && echo "yes" || echo "no"`,
         sshOpts
       );
 
       if (hasRepo.trim() === "yes") {
         await this.remoteExec(
           target,
           `cd ${sourcePath} && git fetch --all && git reset --hard ${config.ref}`,
           sshOpts
         );
       } else {
         await this.remoteExec(
           target,
           `git clone ${config.repo} ${sourcePath} && cd ${sourcePath} && git checkout ${config.ref}`,
           sshOpts
         );
       }
 
       // Create release
       const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
       const releasePath = `${remotePath}/releases/${timestamp}`;
 
       await this.remoteExec(
         target,
         `mkdir -p ${remotePath}/releases && cp -r ${sourcePath} ${releasePath}`,
         sshOpts
       );
 
       // Symlink current
       await this.remoteExec(
         target,
         `rm -f ${currentPath} && ln -s ${releasePath} ${currentPath}`,
         sshOpts
       );
 
       // Post-deploy hook
       if (config.postDeploy) {
         console.log(`[bm2] Running post-deploy: ${config.postDeploy}`);
         const envStr = config.env
           ? Object.entries(config.env)
               .map(([k, v]) => `${k}=${v}`)
               .join(" ")
           : "";
         await this.remoteExec(
           target,
           `cd ${currentPath} && ${envStr} ${config.postDeploy}`,
           sshOpts
         );
       }
 
       // Cleanup old releases (keep last 5)
       await this.remoteExec(
         target,
         `cd ${remotePath}/releases && ls -dt */ | tail -n +6 | xargs rm -rf`,
         sshOpts
       );
 
       console.log(`[bm2] ✓ Deploy to ${target} complete`);
     }
   }
 
   async setup(config: DeployConfig): Promise<void> {
     const hosts = Array.isArray(config.host) ? config.host : [config.host];
     const sshOpts = config.ssh_options || "";
 
     for (const host of hosts) {
       const target = `${config.user}@${host}`;
       console.log(`[bm2] Setting up ${target}...`);
 
       await this.remoteExec(
         target,
         `mkdir -p ${config.path} ${config.path}/releases ${config.path}/source ${config.path}/shared`,
         sshOpts
       );
 
       if (config.preSetup) {
         await this.remoteExec(target, config.preSetup, sshOpts);
       }
 
       // Clone repo
       await this.remoteExec(
         target,
         `git clone ${config.repo} ${config.path}/source && cd ${config.path}/source && git checkout ${config.ref}`,
         sshOpts
       );
 
       if (config.postSetup) {
         await this.remoteExec(
           target,
           `cd ${config.path}/source && ${config.postSetup}`,
           sshOpts
         );
       }
 
       console.log(`[bm2] ✓ Setup complete for ${target}`);
     }
   }
 
   private async remoteExec(target: string, command: string, sshOpts: string): Promise<string> {
     const args = ["ssh"];
     if (sshOpts) args.push(...sshOpts.split(" "));
     args.push(target, command);
 
     const proc = Bun.spawn(args, {
       stdout: "pipe",
       stderr: "pipe",
     });
 
     const stdout = await new Response(proc.stdout).text();
     const stderr = await new Response(proc.stderr).text();
     const exitCode = await proc.exited;
 
     if (exitCode !== 0 && stderr) {
       console.error(`[bm2] Remote error: ${stderr}`);
     }
     if (stdout.trim()) {
       console.log(stdout.trim());
     }
 
     return stdout;
   }
 
   private async localExec(command: string): Promise<string> {
     const proc = Bun.spawn(["sh", "-c", command], {
       stdout: "pipe",
       stderr: "pipe",
     });
 
     const stdout = await new Response(proc.stdout).text();
     const stderr = await new Response(proc.stderr).text();
     const exitCode = await proc.exited;
 
     if (exitCode !== 0 && stderr) {
       console.error(`[bm2] Local error: ${stderr}`);
     }
     if (stdout.trim()) {
       console.log(stdout.trim());
     }
 
     return stdout;
   }
 }
