import { createHash } from "node:crypto";

import { Client, type ClientChannel, type ConnectConfig } from "ssh2";

export type Ssh2Client = Client;

export const createSsh2Client = (): Ssh2Client => new Client();

export const sshHostKeyFingerprintSha256 = (hostKey: Buffer): string => {
  const digest = createHash("sha256").update(hostKey).digest("base64");
  return `SHA256:${digest.replace(/=+$/, "")}`;
};

export const shellQuotePosix = (value: string): string => {
  if (value.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
};

/** `cd` prefix for remote shell commands; `~` is expanded by bash, not quoted. */
export const buildRemoteCdPrefix = (cwd: string | undefined): string => {
  if (cwd === undefined || cwd.length === 0) {
    return "";
  }
  if (cwd === "~") {
    return "cd ~ && ";
  }
  return `cd ${shellQuotePosix(cwd)} && `;
};

export const buildRemoteCommand = (input: {
  readonly cwd: string;
  readonly command: string;
  readonly args?: readonly string[];
}): string => {
  const commandLine =
    input.args === undefined || input.args.length === 0
      ? input.command
      : [input.command, ...input.args].map(shellQuotePosix).join(" ");
  return `${buildRemoteCdPrefix(input.cwd)}${commandLine}`;
};

export const collectChannelOutput = (
  channel: ClientChannel,
): Promise<{ readonly stdout: string; readonly stderr: string; readonly exitCode: number }> =>
  new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let exitCode = 0;

    channel.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    channel.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });
    channel.on("exit", (code) => {
      exitCode = typeof code === "number" ? code : 1;
    });
    channel.on("close", () => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode,
      });
    });
    channel.on("error", reject);
  });

export type SshConnectOptions = {
  readonly config: ConnectConfig;
};

export const connectSsh2Client = (client: Ssh2Client, options: SshConnectOptions): Promise<void> =>
  new Promise((resolve, reject) => {
    client
      .once("ready", () => {
        resolve();
      })
      .once("error", reject)
      .connect(options.config);
  });

export const isSsh2ClientAlive = (client: Ssh2Client): boolean =>
  (client as { destroyed?: boolean }).destroyed !== true;

export const endSsh2Client = (client: Ssh2Client): Promise<void> =>
  new Promise((resolve) => {
    if ((client as { destroyed?: boolean }).destroyed === true) {
      resolve();
      return;
    }
    client.once("close", () => resolve());
    client.end();
  });
