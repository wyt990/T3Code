import {
  SshCommandError,
  SshConnectionError,
  SshConnectionNotFoundError,
  SshCredentialUnavailableError,
  SshFileSystemError,
  SshHostKeyUnknownError,
  SshHostKeyUntrustedError,
  type SshError,
} from "./Errors.ts";

const fromRawMessage = (message: string): string => {
  const lower = message.toLowerCase();

  if (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("ready timeout")
  ) {
    return "SSH 连接超时，请检查主机地址、端口与网络。";
  }

  if (
    lower.includes("econnrefused") ||
    lower.includes("connection refused") ||
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo")
  ) {
    return "无法连接到 SSH 主机，请确认主机名、端口与防火墙设置。";
  }

  if (
    lower.includes("authentication") ||
    lower.includes("auth fail") ||
    lower.includes("permission denied") ||
    lower.includes("all configured authentication methods failed")
  ) {
    return "SSH 认证失败，请检查用户名、密码、私钥或 ssh-agent。";
  }

  if (lower.includes("host key") || lower.includes("fingerprint")) {
    return "SSH 主机密钥未信任，请在设置中确认指纹后重试。";
  }

  if (lower.includes("credential") || lower.includes("password auth")) {
    return "SSH 凭据不可用，请在 Desktop 中保存密码或配置私钥路径。";
  }

  return message;
};

export const formatSshUserMessage = (error: unknown): string => {
  if (error instanceof SshConnectionNotFoundError) {
    return "未找到该 SSH 连接配置，请刷新连接列表后重试。";
  }

  if (error instanceof SshCredentialUnavailableError) {
    if (
      error.detail.toLowerCase().includes("password") ||
      error.detail.toLowerCase().includes("passphrase")
    ) {
      return "SSH 密码与私钥口令需使用 Desktop 应用保存，或在连接设置中配置本机私钥路径。";
    }
    return fromRawMessage(error.detail);
  }

  if (error instanceof SshHostKeyUnknownError || error instanceof SshHostKeyUntrustedError) {
    return "SSH 主机密钥未信任，请在设置中确认指纹后重试。";
  }

  if (error instanceof SshConnectionError) {
    return fromRawMessage(error.detail);
  }

  if (error instanceof SshCommandError) {
    if (error.detail.toLowerCase().includes("timed out")) {
      return "远程命令执行超时，请稍后重试或检查远程主机负载。";
    }
    return fromRawMessage(error.detail);
  }

  if (error instanceof SshFileSystemError) {
    return `远程文件操作失败（${error.operation}）：${fromRawMessage(error.detail)}`;
  }

  if (error instanceof Error) {
    return fromRawMessage(error.message);
  }

  return fromRawMessage(String(error));
};

export const formatSshError = (error: SshError): string => formatSshUserMessage(error);
