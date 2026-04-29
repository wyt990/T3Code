import type { InstallMethodId, InstallMethod } from "./installMethods.ts";
import { INSTALL_METHODS } from "./installMethods.ts";

export interface InstallStrategy {
  readonly platform: NodeJS.Platform;
  readonly methodPriority: readonly InstallMethodId[];
}

/**
 * Platform-specific installation strategy with prioritization.
 *
 * Priority order is based on:
 * 1. Native package managers (scoop, brew, pacman) - best integration
 * 2. Node package managers (npm, bun, pnpm) - widely available
 * 3. Version managers (mise, nix) - for advanced users
 * 4. YOLO (curl | bash) - last resort
 */
const DEFAULT_STRATEGY: InstallStrategy = {
  platform: "linux",
  methodPriority: ["npm", "bun", "pnpm", "yarn", "yolo"],
};

const STRATEGIES_BY_PLATFORM: Partial<Record<NodeJS.Platform, InstallStrategy>> = {
  win32: {
    platform: "win32",
    methodPriority: ["scoop", "choco", "npm", "bun", "pnpm", "yarn", "yolo"],
  },
  darwin: {
    platform: "darwin",
    methodPriority: [
      "brew-tap",
      "brew-official",
      "npm",
      "bun",
      "pnpm",
      "yarn",
      "mise",
      "nix",
      "yolo",
    ],
  },
  linux: {
    platform: "linux",
    methodPriority: [
      "brew-tap",
      "pacman",
      "paru",
      "npm",
      "bun",
      "pnpm",
      "yarn",
      "mise",
      "nix",
      "yolo",
    ],
  },
  aix: DEFAULT_STRATEGY,
  android: DEFAULT_STRATEGY,
  freebsd: DEFAULT_STRATEGY,
  sunos: DEFAULT_STRATEGY,
};

/**
 * Resolve available installation methods for the current platform.
 * Returns methods in priority order, filtered by availability.
 */
export function resolveAvailableMethods(platform: NodeJS.Platform): ReadonlyArray<InstallMethod> {
  const strategy = STRATEGIES_BY_PLATFORM[platform] ?? DEFAULT_STRATEGY;

  const available: InstallMethod[] = [];

  for (const methodId of strategy.methodPriority) {
    const method = INSTALL_METHODS[methodId];
    if (method && method.checkAvailable()) {
      // For platform-specific methods, check if they apply
      if (method.platform !== "all" && method.platform !== platform) {
        continue;
      }
      available.push(method);
    }
  }

  return available;
}

/**
 * Get the recommended installation method for the current platform.
 * Returns the first available method, or null if none available.
 */
export function getRecommendedMethod(platform: NodeJS.Platform): InstallMethod | null {
  const available = resolveAvailableMethods(platform);
  return available[0] ?? null;
}

/**
 * Check if a method requires special confirmation (YOLO or sudo).
 */
export function requiresConfirmation(method: InstallMethod): boolean {
  return method.isYolo === true || method.requiresSudo === true;
}

/**
 * Get confirmation message for a method.
 */
export function getConfirmationMessage(method: InstallMethod): string {
  if (method.isYolo) {
    return (
      "This installation method downloads a script from opencode.ai and executes it.\n\n" +
      "While convenient, this method:\n" +
      "- Downloads code over the network without verification\n" +
      "- Executes with your user permissions\n" +
      "- Is less secure than package manager installation\n\n" +
      "Consider using npm, bun, or Homebrew instead.\n\n" +
      "Continue anyway?"
    );
  }

  if (method.requiresSudo) {
    return (
      `This installation method (${method.label}) requires administrator privileges.\n\n` +
      "You may be prompted for your password.\n\n" +
      "Continue?"
    );
  }

  return "";
}
