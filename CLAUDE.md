# OpenWolf

@.wolf/OPENWOLF.md

This project uses OpenWolf for context management. Read and follow .wolf/OPENWOLF.md every session. Check .wolf/cerebrum.md before generating code. Check .wolf/anatomy.md before reading files.

# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此仓库中工作提供指导。

## 工程协作四原则

### 1. 先想后写（Think Before Coding）

**不要假设，不要藏着疑惑，把取舍摆出来。**
动手之前：- 明确说出你的假设，如果不确定，就问。- 如果存在多种理解，把它们列出来，不要自己悄悄选一个。- 如果有更简单的方案，说出来，推一下。- 如果有什么搞不清楚，停下来，说清楚哪里不明白，再问。

### 2. 能简则简（Simplicity First）

**用最少的代码解决问题，不做多余的事。**

- 不加用户没要求的功能。- 不为一次性逻辑搭抽象层。- 不预加"灵活性"或"可配置性"。
- 不为不可能发生的场景写错误处理。- 如果写了 200 行但 50 行够用，重写。
  自检标准：一个高级工程师看了会觉得过度设计吗？如果会，简化。

### 3. 精准修改（Surgical Changes）

**只动你该动的地方，只清理你自己制造的烂摊子。**
修改已有代码时：- 不要"顺手优化"旁边的代码、注释或格式。

- 不要重构没有问题的逻辑。- 保持原有风格，即使你觉得可以写得更好。- 发现不相关的死代码，提一句，不要擅自删。当你的改动制造了孤儿代码时：- 清掉你的改动造成的多余 import、变量、函数。
- 原来就有的死代码，不要动，除非被要求。检验标准：每一处改动都能直接追溯到用户的请求。

### 4. 目标驱动执行（Goal-Driven Execution）

**定义成功标准，循环直到验证通过。**
把指令转化成可验证的目标：- "加一个校验" → "先写覆盖非法输入的测试，再让测试通过"

- "修这个 bug" → "先写能复现 bug 的测试，再修"
- "重构 X" → "确保重构前后测试都通过"
  多步骤任务，列出简要计划：

1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]

## Task Completion Requirements

- All of `bun fmt`, `bun lint`, and `bun typecheck` must pass before considering tasks completed.
- NEVER run `bun test`. Always use `bun run test` (runs Vitest).

## Project Overview

T3 Code is a minimal web GUI for using coding agents like Codex and Claude. This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Common Commands

```bash
# Development
bun run dev              # Start full dev environment (server + web + desktop)
bun run dev:server       # Start only the server
bun run dev:web          # Start only the web frontend
bun run dev:desktop      # Start Electron desktop app in dev mode

# Build
bun run build            # Build all packages
bun run build:contracts  # Build only the contracts package (required before dev)
bun run build:desktop    # Build desktop app for distribution

# Desktop Distribution
bun run dist:desktop:win:x64     # Build Windows x64 installer
bun run dist:desktop:win:arm64   # Build Windows ARM64 installer
bun run dist:desktop:dmg:arm64   # Build macOS ARM64 DMG
bun run dist:desktop:dmg:x64     # Build macOS x64 DMG
bun run dist:desktop:linux       # Build Linux AppImage

# Quality
bun run typecheck        # Run TypeScript type checking
bun run lint             # Run oxlint
bun run fmt              # Format code with oxfmt
bun run fmt:check        # Check formatting without modifying

# Testing
bun run test             # Run all tests (Vitest)
bun run test:browser     # Run browser tests (requires playwright install)

# Single test file
bun vitest run path/to/test.test.ts
```

## Package Architecture

This is a Bun + Electron monorepo with the following structure:

### Apps

- **`apps/server`**: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions. Entry point: `src/bin.ts`.

- **`apps/web`**: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.

- **`apps/desktop`**: Electron wrapper. Embeds the server and serves the web app in a native window.

### Packages

- **`packages/contracts`**: Shared Effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. **Keep this package schema-only — no runtime logic.** Must be built before other packages can use it.

- **`packages/shared`**: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`, `@t3tools/shared/model`) — **no barrel index**.

- **`packages/client-runtime`**: Client-side runtime utilities for environment management and thread operations.

- **`packages/effect-codex-app-server`**: Effect-based wrapper for Codex app-server protocol.

- **`packages/effect-acp`**: Effect-based Agent Communication Protocol implementation.

## Key Architecture Patterns

### Provider System

T3 Code is currently Codex-first. The server starts `codex app-server` (JSON-RPC over stdio) per provider session, then streams structured events to the browser through WebSocket push messages.

- Session startup/resume and turn lifecycle: `apps/server/src/provider/Layers/`
- Provider dispatch and thread event logging: `apps/server/src/provider/`
- WebSocket server routes NativeApi methods: `apps/server/src/ws.ts`
- Web app consumes orchestration domain events via WebSocket push on channel `orchestration.domainEvent`

### State Management

- **Server**: Effect-based with SQLite persistence (`apps/server/src/persistence/`)
- **Web**: Zustand stores (`apps/web/src/store.ts`, `apps/web/src/uiStateStore.ts`, `apps/web/src/composerDraftStore.ts`)
- **Orchestration**: Event-sourced command handling in `apps/server/src/orchestration/`

### WebSocket Communication

The web app communicates with the server via WebSocket using a request/response pattern with RPC-style methods. The server pushes domain events to the client for real-time updates.

Key files:

- Server: `apps/server/src/ws.ts`
- Client: `apps/web/src/rpc/`

### Observability

Server-side observability uses:

- Pretty logs to stdout for humans
- NDJSON trace files for debugging (`~/.t3/userdata/logs/server.trace.ndjson`)
- Optional OTLP export for Grafana/Tempo/Prometheus

See `docs/observability.md` for detailed usage.

## Maintainability Guidelines

Long term maintainability is a core priority. If you add new functionality:

1. First check if there is shared logic that can be extracted to a separate module.
2. Duplicate logic across multiple files is a code smell and should be avoided.
3. Don't be afraid to change existing code.
4. Don't take shortcuts by just adding local logic to solve a problem.

## Performance Optimization Guidelines

### Type Checking Optimizations

To improve `bun run typecheck` performance:

1. **Enable Turbo Caching**
   - Ensure `turbo.json` has `"cache": true` for the `typecheck` task
   - This allows incremental checks of unchanged files

2. **Parallelize Type Checking**
   - Change `dependsOn: ["^typecheck"]` to `dependsOn: ["^build"]` in `turbo.json`
   - This allows packages to typecheck in parallel instead of serially waiting for dependencies

3. **Reduce Effect Language Service Overhead**
   - In tsconfig.json files, set Effect diagnostics to "off" during development:

   ```json
   "diagnosticSeverity": {
     "importFromBarrel": "off",
     "anyUnknownInErrorContext": "off",
     "instanceOfSchema": "off",
     "deterministicKeys": "off"
   }
   ```

   - These checks are valuable but expensive; disable them locally for faster feedback

4. **Use Filtered Checks for Development**
   - Use `bun run typecheck:changed` to only check changed files
   - This script uses `--filter=...[HEAD^]` to target only modified packages

5. **Production vs Development Tradeoffs**
   - Keep strict settings in CI/production
   - Optimize for speed in local development
   - The goal is fast feedback loops without sacrificing correctness

## Technology Stack

- **Runtime**: Bun (package manager and runtime)
- **Build**: tsdown, Vite, Turbo
- **Frontend**: React 19, Tailwind CSS 4, TanStack Router/Query, Zustand
- **Backend**: Effect, SQLite
- **Desktop**: Electron
- **Testing**: Vitest, Playwright (browser tests)
- **Linting/Formatting**: oxlint, oxfmt

## Environment Variables

Key environment variables (see `turbo.json` for full list):

- `T3CODE_HOME`: Override home directory (default: `~/.t3`)
- `T3CODE_PORT`: Server port (default: 5733)
- `T3CODE_NO_BROWSER`: Disable auto-opening browser
- `T3CODE_TRACE_MIN_LEVEL`: Minimum trace level (default: Info)
- `T3CODE_OTLP_TRACES_URL`: OTLP trace endpoint for observability
- `T3CODE_OTLP_METRICS_URL`: OTLP metrics endpoint

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- Codex-Monitor (Tauri reference): https://github.com/Dimillian/CodexMonitor
