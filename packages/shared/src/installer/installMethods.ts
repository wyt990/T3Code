import { isCommandAvailable } from "../shell.ts";

export type InstallMethodId =
  | "scoop"
  | "choco"
  | "brew-tap"
  | "brew-official"
  | "pacman"
  | "paru"
  | "npm"
  | "bun"
  | "pnpm"
  | "yarn"
  | "mise"
  | "nix"
  | "yolo";

export interface InstallMethod {
  readonly id: InstallMethodId;
  readonly label: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly requiresSudo?: boolean;
  readonly isYolo?: boolean;
  readonly platform: NodeJS.Platform | "all";
  readonly checkAvailable: () => boolean;
}

export const INSTALL_METHODS: Record<InstallMethodId, InstallMethod> = {
  // Windows - Scoop
  scoop: {
    id: "scoop",
    label: "Scoop",
    command: "scoop",
    args: ["install", "opencode"],
    platform: "win32",
    checkAvailable: () => isCommandAvailable("scoop"),
  },
  // Windows - Chocolatey
  choco: {
    id: "choco",
    label: "Chocolatey",
    command: "choco",
    args: ["install", "opencode", "-y"],
    requiresSudo: true,
    platform: "win32",
    checkAvailable: () => isCommandAvailable("choco"),
  },
  // macOS/Linux - Homebrew (Tap - recommended, always up to date)
  "brew-tap": {
    id: "brew-tap",
    label: "Homebrew (Tap)",
    command: "brew",
    args: ["install", "anomalyco/tap/opencode"],
    platform: "darwin", // Also works on Linux with Homebrew
    checkAvailable: () => isCommandAvailable("brew"),
  },
  // macOS/Linux - Homebrew (Official formula, updated less)
  "brew-official": {
    id: "brew-official",
    label: "Homebrew (Official)",
    command: "brew",
    args: ["install", "opencode"],
    platform: "darwin",
    checkAvailable: () => isCommandAvailable("brew"),
  },
  // Arch Linux - Pacman (Stable)
  pacman: {
    id: "pacman",
    label: "Pacman",
    command: "sudo",
    args: ["pacman", "-S", "--noconfirm", "opencode"],
    requiresSudo: true,
    platform: "linux",
    checkAvailable: () => isCommandAvailable("pacman"),
  },
  // Arch Linux - Paru (AUR - Latest)
  paru: {
    id: "paru",
    label: "Paru (AUR)",
    command: "paru",
    args: ["-S", "--noconfirm", "opencode-bin"],
    platform: "linux",
    checkAvailable: () => isCommandAvailable("paru"),
  },
  // Cross-platform - npm
  npm: {
    id: "npm",
    label: "npm",
    command: "npm",
    args: ["i", "-g", "opencode-ai@latest"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("npm"),
  },
  // Cross-platform - Bun
  bun: {
    id: "bun",
    label: "Bun",
    command: "bun",
    args: ["i", "-g", "opencode-ai@latest"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("bun"),
  },
  // Cross-platform - pnpm
  pnpm: {
    id: "pnpm",
    label: "pnpm",
    command: "pnpm",
    args: ["i", "-g", "opencode-ai@latest"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("pnpm"),
  },
  // Cross-platform - Yarn
  yarn: {
    id: "yarn",
    label: "Yarn",
    command: "yarn",
    args: ["global", "add", "opencode-ai@latest"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("yarn"),
  },
  // Cross-platform - Mise
  mise: {
    id: "mise",
    label: "Mise",
    command: "mise",
    args: ["use", "-g", "opencode"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("mise"),
  },
  // Cross-platform - Nix
  nix: {
    id: "nix",
    label: "Nix",
    command: "nix",
    args: ["run", "nixpkgs#opencode"],
    platform: "all",
    checkAvailable: () => isCommandAvailable("nix"),
  },
  // YOLO - curl | bash (last resort)
  yolo: {
    id: "yolo",
    label: "Script Install",
    command: "bash",
    args: ["-c", "curl -fsSL https://opencode.ai/install | bash"],
    isYolo: true,
    platform: "all",
    checkAvailable: () => isCommandAvailable("curl") && isCommandAvailable("bash"),
  },
};
