# T3 Code

T3 Code 是一个极简的编程代理 Web GUI（目前支持 Codex、Claude、Cursor 和 OpenCode，更多支持即将推出）。

> [!IMPORTANT]
> 本项目为 Claude Code 的**非官方二次开发版本**，原版项目地址：https://github.com/anthropics/claude-code
>
> 二次开发版本项目地址：https://github.com/wyt990/claude-code-haha

## 功能特性

- **多提供商支持**：支持 Codex、Claude Agent、Cursor 和 OpenCode
- **动态模型发现**：自动检测并显示可用的 AI 模型
- **桌面应用**：提供原生桌面应用体验
- **实时通信**：基于 WebSocket 的实时事件推送
- **会话持久化**：支持会话恢复和历史记录

## 安装

> [!WARNING]
> T3 Code 目前支持多个提供商。使用前请至少安装并认证一个提供商：
>
> - **Codex**：安装 [Codex CLI](https://github.com/openai/codex) 并运行 `codex login`
> - **Claude**：安装 Claude Code（见下方安装方法）并运行 `claude auth login`
> - **Cursor**：安装 Cursor IDE（需要 Agent 模式支持）
> - **OpenCode**：安装 OpenCode CLI（见下方安装方法）并配置提供商

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

**安装目录 `.env` 的命令行维护**：

在已设置 `CLAUDE_CODE_INSTALL_PREFIX` 的前提下，可执行 `claudecode --help` 查看 `--env-list`、`--env-set`、`--add-provider` 等与安装前缀 `.env` 相关的子命令。其中 **`--force` 仅作用于上述 env 维护子命令**（用于非交互场景下跳过删除关键键、导出含密钥等确认）。

### OpenCode 安装

OpenCode 是一个开源的 AI 编程助手 CLI 工具，可通过以下方式安装：

**Linux / macOS：**

```bash
curl -fsSL https://raw.githubusercontent.com/opencode-ai/opencode/main/install/install.sh | bash
```

**Windows（PowerShell）：**

```powershell
irm https://raw.githubusercontent.com/opencode-ai/opencode/main/install/install.ps1 | iex
```

**使用 Go 安装：**

```bash
go install github.com/opencode-ai/opencode/cmd/opencode@latest
```

安装完成后，运行 `opencode` 并配置你的 API 提供商。

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

### OpenCode

OpenCode 提供商通过 OpenCode CLI 自动发现可用的模型和提供商。

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

## 项目架构

这是一个 Bun + Electron 单体仓库，结构如下：

### 应用

- **`apps/server`**：Node.js WebSocket 服务器。封装 Codex app-server（基于 stdio 的 JSON-RPC），提供 React Web 应用服务，管理提供商会话。入口点：`src/bin.ts`。

- **`apps/web`**：React/Vite UI。负责会话用户体验、对话/事件渲染和客户端状态管理。通过 WebSocket 连接服务器。

- **`apps/desktop`**：Electron 封装。嵌入服务器并在原生窗口中提供 Web 应用。

### 包

- **`packages/contracts`**：共享的 Effect/Schema 模式和 TypeScript 契约，用于提供商事件、WebSocket 协议和模型/会话类型。**此包仅包含模式定义，不包含运行时逻辑。** 必须在其他包使用前构建。

- **`packages/shared`**：服务器和 Web 共用的运行时工具。使用显式子路径导出（如 `@t3tools/shared/git`、`@t3tools/shared/model`）——**无桶式索引文件**。

- **`packages/client-runtime`**：客户端运行时工具，用于环境管理和线程操作。

- **`packages/effect-codex-app-server`**：基于 Effect 的 Codex app-server 协议封装。

- **`packages/effect-acp`**：基于 Effect 的 Agent Communication Protocol 实现。

## 核心架构模式

### 提供商系统

服务器为每个提供商会话启动子进程（如 `codex app-server`、`claudecode`），然后通过 WebSocket 推送将结构化事件流式传输到浏览器。

- 会话启动/恢复和轮次生命周期：`apps/server/src/provider/Layers/`
- 提供商调度和线程事件日志：`apps/server/src/provider/`
- WebSocket 服务器路由 NativeApi 方法：`apps/server/src/ws.ts`
- Web 应用通过 WebSocket 推送消费编排领域事件（频道 `orchestration.domainEvent`）

### 状态管理

- **服务器**：基于 Effect，使用 SQLite 持久化（`apps/server/src/persistence/`）
- **Web**：Zustand 存储（`apps/web/src/store.ts`、`apps/web/src/uiStateStore.ts`、`apps/web/src/composerDraftStore.ts`）
- **编排**：`apps/server/src/orchestration/` 中的事件溯源命令处理

### WebSocket 通信

Web 应用通过 WebSocket 使用请求/响应模式与服务器通信，采用 RPC 风格的方法。服务器向客户端推送领域事件以实现实时更新。

关键文件：

- 服务器端：`apps/server/src/ws.ts`
- 客户端：`apps/web/src/rpc/`

### 可观测性

服务器端可观测性使用：

- 人类可读的格式化日志输出到 stdout
- NDJSON 格式的追踪文件用于调试（`~/.t3/userdata/logs/server.trace.ndjson`）
- 可选的 OTLP 导出用于 Grafana/Tempo/Prometheus

详见 `docs/observability.md`。

## 环境变量

关键环境变量（完整列表见 `turbo.json`）：

- `T3CODE_HOME`：覆盖主目录（默认：`~/.t3`）
- `T3CODE_PORT`：服务器端口（默认：5733）
- `T3CODE_NO_BROWSER`：禁用自动打开浏览器
- `T3CODE_TRACE_MIN_LEVEL`：最小追踪级别（默认：Info）
- `T3CODE_OTLP_TRACES_URL`：OTLP 追踪端点用于可观测性
- `T3CODE_OTLP_METRICS_URL`：OTLP 指标端点

## 技术栈

- **运行时**：Bun（包管理器和运行时）
- **构建**：tsdown、Vite、Turbo
- **前端**：React 19、Tailwind CSS 4、TanStack Router/Query、Zustand
- **后端**：Effect、SQLite
- **桌面**：Electron
- **测试**：Vitest、Playwright（浏览器测试）
- **代码检查/格式化**：oxlint、oxfmt

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

**示例：**

```bash
# 更新到 0.0.22 版本
bun run scripts/update-release-package-versions.ts 0.0.22

# 更新到 1.0.0 版本
bun run scripts/update-release-package-versions.ts 1.0.0
```

脚本会自动检查并更新所有发布包的版本号，如果版本号已匹配则跳过。

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
