import { execSync } from "node:child_process";
import nodeFs from "node:fs";
import nodePath from "node:path";

/**
 * Resolves the Bun executable for scripts that run under Node (e.g. Turbo
 * running `node scripts/cli.ts build`). In that case `bun` may not be on PATH
 * for spawned children, and `npm_execpath` is not always forwarded.
 */
export function resolveBunExecutablePath(): string {
  const execPathLower = process.execPath.toLowerCase();
  const npmExec = process.env.npm_execpath;
  if (npmExec?.toLowerCase().includes("bun")) {
    return npmExec;
  }
  if (execPathLower.includes("bun")) {
    return process.execPath;
  }

  if (process.platform === "win32") {
    const candidates: string[] = [];

    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(nodePath.join(appData, "npm", "node_modules", "bun", "bin", "bun.exe"));
    }

    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      candidates.push(
        nodePath.join(
          localAppData,
          "Microsoft",
          "WinGet",
          "Packages",
          "Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe",
          "bun-windows-x64",
          "bun.exe",
        ),
      );
    }

    const profile = process.env.USERPROFILE;
    if (profile) {
      candidates.push(nodePath.join(profile, ".bun", "bin", "bun.exe"));
    }

    for (const candidate of candidates) {
      if (candidate && nodeFs.existsSync(candidate)) {
        return candidate;
      }
    }

    try {
      const out = execSync("where.exe bun", {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      });
      const first = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first && nodeFs.existsSync(first)) {
        return first;
      }
    } catch {
      // ignore — fall through to "bun"
    }
  }

  return "bun";
}
