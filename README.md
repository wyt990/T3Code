# T3 Code

T3 Code 是一个基于 Web 的多提供商 AI 编程代理 GUI。它为 Codex、Claude Agent、Cursor 和 OpenCode 等多个 AI 编程代理提供商提供了统一的 Web 界面和桌面应用。

> [!IMPORTANT]
> 本项目为 Claude Code 的**非官方二次开发版本**，原版项目地址：https://github.com/anthropics/claude-code
>
> 二次开发版本项目地址：https://github.com/wyt990/claude-code-haha

## 功能特性

### 多提供商支持
- **Codex** — 通过 JSON-RPC over stdio 与 `codex app-server` 集成
- **Claude Agent** — 通过 Claude Agent SDK 集成
- **Cursor** — 通过 Agent Communication Protocol (ACP) 集成
- **OpenCode** — 通过 OpenCode SDK 集成
- **动态模型发现** — 自动检测并显示各提供商的可用 AI 模型
- **提供商安装器** — 自动检测和安装提供商的 CLI 工具

### 工作区架构
- **本地/远程统一执行抽象** — `WorkspaceExecution` 接口统一了本地进程和 SSH 远程执行，上层模块无需关心执行位置
- **本地工作区** — 直接使用系统进程、PTY 终端
- **SSH 远程工作区** — 通过 SSH2 连接远程服务器，支持 exec、交互式 shell 和 SFTP 文件系统
- **SSH 连接池** — 复用 SSH 连接，支持多通道（git、probe、interactive、workspace）

### SSH 远程开发
- SSH 连接管理（添加、编辑、删除、测试连接）
- SSH 密钥/密码认证，凭据加密持久化
- 远程主机密钥验证
- TCP 端口转发
- 远程提供商进程管理
- 远程文件系统浏览
- 远程终端

### 会话管理
- **事件溯源编排系统** — CQRS 架构的命令处理系统，可靠管理会话生命周期
- **多线程支持** — 每个提供商会话可管理多个线程（thread）
- **会话恢复** — 支持断线重连和会话历史恢复
- **双流数据更新** — shell stream（线程摘要）与 detail stream（线程内消息）分流写入

### 桌面应用（Electron）
- **原生窗口体验** — 嵌入后端服务器，自动管理子进程生命周期
- **t3:// 自定义协议** — 支持浏览器深度链接
- **自动更新** — 支持 stable/nightly 双更新通道
- **SSH 凭据服务器** — 通过本地 HTTP 服务线程安全地提供 SSH 凭据
- **客户端持久化** — 设置、环境变量、SSH 密钥加密存储
- **网络模式切换** — `local-only`（127.0.0.1）和 `network-accessible`（0.0.0.0/::）
- **端口自动扫描** — 从 3773 开始，最多扫描 10 个端口

### 终端
- PTY 终端集成（基于 node-pty）
- 远程 SSH 终端
- 持久化终端会话

### 代码质量门控
- 代码质量检查组（lint/typecheck/test 等）
- 回合门控分发摘要
- 回合间文本比对

### 环境管理
- **执行环境** — 管理多个开发环境（本地环境、SSH 远程环境）
- **环境变量管理** — 支持环境变量的配置和注入
- **Shell 环境同步** — 从 login shell 读取 PATH 和 env

### 多 Agent 协作
- Agent 通信协议（ACP）实现
- 多 Agent 调度

### 上下文感知
- 依赖图分析
- 上下文池管理

### 可视化
- 基于 @xyflow/react 的流程图/关系图渲染
- Agent 活动可视化

### 工程工具
- **Git 集成** — 分支管理、状态查看、PR 操作、工作树管理
- **实时事件推送** — 基于 WebSocket 的领域事件流
- **一键打开文件** — 在外部编辑器中打开文件
- **快捷键系统** — 可自定义的快捷键绑定
- **可观测性** — NDJSON 追踪文件、OTLP 导出（Grafana/Tempo/Prometheus）

## 安装

> [!WARNING]
> T3 Code 目前支持多个提供商。使用前请至少安装并认证一个提供商：
>
> - **Codex**：安装 [Codex CLI](https://github.com/openai/codex) 并运行 `codex login`
> - **Claude**：安装 Claude Code（见下方安装方法）并运行 `claude auth login`
> - **Cursor**：安装 Cursor IDE（需要 Agent 模式支持）
> - **OpenCode**：安装 OpenCode CLI 并配置提供商

### Claude Code 安装（二次开发版本）

本项目包含 Claude Code 的二次开发版本，可通过以下方式安装：

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.sh | bash

# 安装完成后配置文件默认位置：/root/.local/share/claude-code-local/.env
```

**Windows（PowerShell）：**

```powershell
irm https://raw.githubusercontent.com/wyt990/claude-code-haha/main/install/install.ps1 | iex
```

安装说明：

- **当前工作目录**：即你打开的项目目录
- **API 等配置**：写在安装目录下的 `.env` 文件中
- 启动器会设置 **`CLAUDE_CODE_INSTALL_PREFIX`**，运行时从该目录加载 `.env`（不覆盖你已在 shell 里导出的变量）
- 解析 GitHub API 需要 **`jq` 或 `python3`**（与 `curl`、`tar` 一并说明见 `install/README.md`）

### 无需安装直接运行

```bash
npx t3
```

### 桌面应用

从 [GitHub Releases](https://github.com/pingdotgg/t3code/releases) 下载最新版本的桌面应用，或使用以下包管理器安装：

#### Windows (`winget`)

```bash
winget install T3Tools.T3Code
```

#### macOS (Homebrew)

```bash
brew install --cask t3-code
```

#### Arch Linux (AUR)

```bash
yay -S t3code-bin
```

## 提供商配置

### Claude Agent

T3 Code 会自动检测 Claude Code 的安装位置和配置：

- **Windows**：`%LOCALAPPDATA%\claude-code-local\claudecode.exe`
- **macOS/Linux**：`~/.claude-code-local/claudecode`

Claude Code 的 `.env` 文件中的环境变量（如 API 密钥、提供商配置）会被自动加载。

### OpenAI 兼容提供商

Claude Code 支持配置 OpenAI 兼容的 API 提供商。在 Claude Code 安装目录的 `.env` 文件中配置：

```env
# 启用 OpenAI 兼容模式
CLAUDE_CODE_USE_OPENAI_COMPAT_API=true

# API 基础 URL
ANTHROPIC_BASE_URL=https://your-api-gateway.com/v1

# 认证令牌
ANTHROPIC_AUTH_TOKEN=your-api-key

# 多提供商 JSON 配置
CLAUDE_CODE_COMPAT_PROVIDERS_JSON=[{"id":"provider1","baseUrl":"https://api.example.com/v1","apiKeyEnv":"API_KEY_ENV_VAR","models":["model-1","model-2"]}]
```

## 本地开发

### 环境准备

```bash
# 可选：如果使用 mise 管理开发工具
mise install

# 安装依赖
bun install
```

### 开发命令

```bash
# 启动完整开发环境（服务器 + Web + 桌面应用）
bun run dev

# 仅启动服务器
bun run dev:server

# 仅启动 Web 前端
bun run dev:web

# 以开发模式启动 Electron 桌面应用
bun run dev:desktop
```

### 构建命令

```bash
# 构建所有包
bun run build

# 仅构建 contracts 包（开发前必需）
bun run build:contracts

# 构建桌面应用用于分发
bun run build:desktop
```

### 桌面应用分发

```bash
# 构建 Windows x64 安装包
bun run dist:desktop:win:x64

# 构建 Windows ARM64 安装包
bun run dist:desktop:win:arm64

# 构建 macOS ARM64 DMG
bun run dist:desktop:dmg:arm64

# 构建 macOS x64 DMG
bun run dist:desktop:dmg:x64

# 构建 Linux AppImage
bun run dist:desktop:linux
```

### 代码质量

```bash
# TypeScript 类型检查
bun run typecheck

# 代码检查 (oxlint)
bun run lint

# 代码格式化 (oxfmt)
bun run fmt

# 检查格式但不修改
bun run fmt:check
```

### 测试

```bash
# 运行所有测试 (Vitest)
bun run test

# 运行浏览器测试（需要先安装 playwright）
bun run test:browser

# 运行单个测试文件
bun vitest run path/to/test.test.ts
```

## 技术栈

- **运行时**：Bun（包管理器和运行时）、Node.js 22+
- **构建**：tsdown、Vite、Turbo
- **前端**：React 19、Tailwind CSS 4、TanStack Router/Query、Zustand
- **后端**：Effect、SQLite（持久化）
- **桌面**：Electron 40+、electron-updater
- **测试**：Vitest、Playwright（浏览器测试）
- **代码检查/格式化**：oxlint、oxfmt
- **终端**：node-pty、xterm.js
- **可视化**：@xyflow/react
- **SSH**：ssh2、ssh2-fs

## 项目架构

这是一个 Bun + Electron 单体仓库（Turborepo），结构如下：

```
t3code/
├── apps/
│   ├── server/          # Node.js WebSocket 后端服务器
│   ├── web/             # React/Vite Web 前端
│   └── desktop/         # Electron 桌面应用封装
├── packages/
│   ├── contracts/       # Effect/Schema 契约定义（纯 Schema，无运行时逻辑）
│   ├── shared/          # 共享运行时工具（显式子路径导出）
│   ├── effect-codex-app-server/  # Codex app-server 协议 Effect 封装
│   ├── effect-acp/      # Agent Communication Protocol Effect 实现
│   └── client-runtime/  # 客户端运行时工具
├── scripts/             # 开发/构建/发布脚本
└── docs/                # 文档
```

### 应用模块

#### `apps/server` — 后端服务器

基于 **Effect** 的 Node.js WebSocket 服务器，核心职责：

- **WebSocket 网关** — 通过 `effect/unstable/rpc` 处理所有客户端 RPC 请求（~80+ 方法）
- **Provider 会话管理** — 管理 Codex/Claude/Cursor/OpenCode 的代理进程生命周期
- **事件溯源编排系统** — CQRS 架构的会话/线程生命周期管理
- **工作区执行抽象** — `WorkspaceExecution` 接口统一本地和 SSH 远程执行
- **SSH 远程支持** — SSH 连接池、SFTP 文件系统、端口转发、凭据管理
- **PTY 终端管理** — node-pty 终端会话
- **持久化层** — SQLite 存储
- **认证系统** — 会话令牌、认证策略
- **Git 集成** — 分支管理、PR 操作
- **可观测性** — NDJSON 追踪、OTLP 导出

#### `apps/web` — Web 前端

React 19 SPA，核心职责：

- **状态管理** — 4 个 Zustand Store（App Store、UI State、Composer Draft、Terminal State 等）
- **WebSocket RPC 通信** — 通过 Effect RPC 与后端通信
- **会话 UI** — AI 对话渲染（消息、活动、Proposed Plan、Diff 统计）
- **提供商配置 UI** — 安装、配置、模型选择
- **终端 UI** — xterm.js 嵌入
- **设置面板** — 通用设置、连接管理、SSH 配置、归档
- **上下文感知 UI** — 依赖图、上下文池
- **多 Agent 协作 UI**
- **可视化** — 流程图/关系图
- **Git UI** — 分支、状态、PR

#### `apps/desktop` — Electron 桌面应用

- 嵌入后端服务器子进程，自动管理生命周期
- IPC 通信（~60+ 通道）：文件系统、客户端持久化、SSH 凭据管理、自动更新等
- t3:// 自定义 URL 协议
- 自动更新系统（stable/nightly 双通道）
- 网络模式切换（local-only / network-accessible）
- Shell 环境同步

### 核心包

#### `packages/contracts` — 契约定义

**纯 Schema 包，不含运行时逻辑。** 定义了所有跨模块共享的 TypeScript 类型和 Effect Schema：

- WebSocket RPC 协议方法及参数/响应 Schema（~80+ 方法）
- Provider 类型（Codex/Claude/Cursor/OpenCode）和模型 Schema
- 编排事件 Schema
- SSH、Git、终端、认证、文件系统等 Schema
- Electron IPC 通道类型

#### `packages/shared` — 共享工具

提供 server 和 web 共同使用的运行时逻辑（显式子路径导出，无 barrel index）：

- 模型选择处理、Git 分支清理、Schema JSON 解码
- Shell 环境探测、端口工具、日志轮转
- 数据结构工具（deepMerge）、搜索排名
- QR 码生成、CLI 参数解析

#### `packages/effect-codex-app-server` — Codex 协议封装

将 Codex `app-server` 的 JSON-RPC over stdio 协议封装为类型安全的 Effect Service：

- 请求/通知/服务端推送的完整 Schema 映射
- 自动生成的方法签名

#### `packages/effect-acp` — ACP 协议实现

Agent Communication Protocol 的 Effect 实现，支持 Cursor 等基于 ACP 的提供商：

- 会话管理、轮次控制
- 事件流处理
- 工具调用

### 核心架构模式

#### 提供商系统

服务器为每个提供商会话启动子进程，通过 WebSocket 推送将结构化事件流式传输到浏览器。

| Provider | 协议 | 子进程 | 适配器文件大小 |
|----------|------|--------|---------------|
| Codex | JSON-RPC over stdio | `codex app-server` | ~52KB |
| Claude Agent | Agent SDK | `claude` CLI | ~108KB |
| Cursor | ACP (Agent Communication Protocol) | `cursor` CLI | ~40KB |
| OpenCode | SDK (npm) | `opencode` CLI | ~52KB |

每个提供商适配器负责：
- 进程启动和参数解析（跨平台二进制发现）
- 会话创建/恢复
- 轮次（Turn）发送
- 事件流解析和规范化
- 会话销毁

#### 工作区执行抽象

`WorkspaceExecution` 是核心抽象接口，统一了本地和远程执行：

```
WorkspaceExecutionResolver
├── LocalExecution    → 本地 Process/Spawn/PTY
└── SshExecution      → SSH exec/spawn/terminal/SFTP
```

上层模块（Provider、Git、Terminal）通过此接口执行操作，无需关心目标环境。

#### SSH 系统

完整的 SSH 远程开发支持：

- **SshConnectionPool** — 连接池管理，支持多通道复用
- **SshFileSystem** — 基于 SFTP 的远程文件系统
- **SshCredentialResolver** — 密钥/密码认证
- **SshHostKeyVerifier** — 主机密钥验证
- **SshPortForward** — TCP 端口转发
- **SshProcessRunner** — 远程进程执行

#### 状态管理

- **服务器端**：Effect 架构 + SQLite 持久化，事件溯源 CQRS
- **Web 端**：4 个 Zustand Store（App Store、UI State Store、Composer Draft Store 等）
- **桌面端**：Electron IPC 通道 + JSON 文件持久化

#### WebSocket 通信

Web 应用通过 WebSocket 使用请求/响应模式（RPC 风格）与服务器通信，服务器通过 `orchestration.domainEvent` 频道推送领域事件。

### 配置架构

- **Turbo Monorepo** — 25 个 `T3CODE_*` 环境变量（端口、认证、追踪等）
- **TypeScript** — 高度严格模式（`strict: true`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax`）

### 环境变量

关键环境变量（完整列表见 `turbo.json`）：

- `T3CODE_HOME`：覆盖主目录（默认：`~/.t3`）
- `T3CODE_PORT`：服务器端口（默认：5733）
- `T3CODE_NO_BROWSER`：禁用自动打开浏览器
- `T3CODE_AUTH_TOKEN`：认证令牌
- `T3CODE_TRACE_MIN_LEVEL`：最小追踪级别（默认：Info）
- `T3CODE_OTLP_TRACES_URL`：OTLP 追踪端点
- `T3CODE_OTLP_METRICS_URL`：OTLP 指标端点

## CI/CD

项目使用 GitHub Actions 进行持续集成和发布：

- **CI** — PR 和 push 到 main 时运行：格式检查、lint、类型检查、测试、Playwright 浏览器测试
- **发布** — 支持 stable（`v*.*.*` 标签）和 nightly（每 3 小时定时）双通道
- **PR 标签** — 自动大小标签（XS-XXL）和贡献者信任标签
- **发布产物** — macOS DMG（arm64/x64）、Linux AppImage、Windows NSIS 安装包

## 版本号管理

### 版本号定义位置

版本号在以下 `package.json` 文件中定义：

| 文件                              | 说明           |
| --------------------------------- | -------------- |
| `apps/server/package.json`        | 服务器包版本   |
| `apps/desktop/package.json`       | 桌面应用包版本 |
| `apps/web/package.json`           | Web 前端包版本 |
| `packages/contracts/package.json` | 共享契约包版本 |

### 更新版本号

**不要手动逐个修改** `package.json` 文件。使用项目提供的脚本统一更新：

```bash
bun run scripts/update-release-package-versions.ts <版本号>
```

### 版本号规范

- **稳定版**：`X.Y.Z` 格式（如 `0.0.22`、`1.0.0`）
- **预发布版**：`X.Y.Z-alpha.N`、`X.Y.Z-beta.N` 格式
- **Nightly 版**：`X.Y.Z-nightly.YYYYMMDD.N` 格式（由 CI 自动生成）

详细的发布流程请参考 [docs/Git操作指南.md](./docs/Git操作指南.md) 和 [docs/release.md](./docs/release.md)。

## 注意事项

本项目处于非常早期阶段，可能会有 bug。

我们目前暂不接受贡献。

可观测性指南：[docs/observability.md](./docs/observability.md)

## 贡献

在提交 issue 或 PR 之前，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

需要支持？加入 [Discord](https://discord.gg/jn4EGJjrvv)。

## 参考资源

- Codex 开源仓库：https://github.com/openai/codex
- Codex App Server 文档：https://developers.openai.com/codex/sdk/#app-server
- Codex-Monitor（Tauri 参考）：https://github.com/Dimillian/CodexMonitor
