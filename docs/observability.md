# 可观测性

T3 Code 有一个服务端可观测性模型：

- 格式化的日志输出到 stdout 供人工阅读
- 完成的 span 写入本地 NDJSON 追踪文件
- 追踪和指标也可以通过 OTLP 导出到真正的后端，如 Grafana LGTM

本地追踪文件是持久化的真实数据源。不再有单独的持久化服务器日志文件。

## 文件位置

### 日志

日志仅面向人工阅读：

- 目标：stdout
- 格式：`Logger.consolePretty()`
- 持久化：无

如果你希望日志消息出现在追踪文件中，请在活动的 span 内使用 `Effect.log...` 发送。`Logger.tracerLogger` 会将其作为 span 事件附加。

### 追踪

完成的 span 以 NDJSON 记录形式写入 `serverTracePath`（默认为 `~/.t3/userdata/logs/server.trace.ndjson`）。

每条记录的重要字段：

- `name`：span 名称
- `traceId`、`spanId`、`parentSpanId`：关联标识
- `durationMs`：耗时
- `attributes`：结构化上下文
- `events`：嵌入的日志和自定义事件
- `exit`：`Success`、`Failure` 或 `Interrupted`

Schema 定义在 `apps/server/src/observability/TraceRecord.ts`。

### 指标

指标不会写入本地文件。

- 本地持久化：无
- 远程导出：仅 OTLP，需配置
- 当前定义：`apps/server/src/observability/Metrics.ts`

如果未配置 OTLP，指标仍然在进程中存在，但不会有本地产物可供检查。

### 相关产物

Provider 运行时流的 Provider 事件 NDJSON 文件仍然存在。这些与主服务器追踪文件是分开的。

## 以可观测模式运行服务器

有两种有用的模式：

- 仅本地：stdout + 本地 `server.trace.ndjson`
- 完整本地可观测性：stdout + 本地追踪文件 + OTLP 导出到 Grafana/Tempo/Prometheus

本地追踪文件始终开启。OTLP 导出为可选启用。

### 选项 1：仅本地追踪

不需要任何额外的环境变量。只需正常运行应用并检查 `server.trace.ndjson`。

示例：

```bash
npx t3
```

```bash
node --run dev
```

```bash
node --run dev:desktop
```

### 选项 2：使用本地 LGTM 栈运行

#### 1. 启动 Grafana LGTM

```bash
docker run --name lgtm \
  -p 3000:3000 \
  -p 4317:4317 \
  -p 4318:4318 \
  --rm -ti \
  grafana/otel-lgtm
```

然后打开 `http://localhost:3000`。

Grafana 默认登录：

- 用户名：`admin`
- 密码：`admin`

#### 2. 设置 OTLP 环境变量

```bash
export T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces
export T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics
export T3CODE_OTLP_SERVICE_NAME=t3-local
```

可选：

```bash
export T3CODE_TRACE_MIN_LEVEL=Info
export T3CODE_TRACE_TIMING_ENABLED=true
```

#### 3. 从同一 shell 启动应用

CLI：

```bash
npx t3
```

Monorepo web/server 开发：

```bash
node --run dev
```

Monorepo 桌面开发：

```bash
node --run dev:desktop
```

打包的桌面应用：

从同一 shell 启动实际的应用可执行文件，以便桌面应用和嵌入式后端继承 `T3CODE_OTLP_*` 环境变量。

macOS 应用包示例：

```bash
T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
T3CODE_OTLP_SERVICE_NAME=t3-desktop \
"/Applications/T3 Code.app/Contents/MacOS/T3 Code"
```

直接二进制示例：

```bash
T3CODE_OTLP_TRACES_URL=http://localhost:4318/v1/traces \
T3CODE_OTLP_METRICS_URL=http://localhost:4318/v1/metrics \
T3CODE_OTLP_SERVICE_NAME=t3-desktop \
./path/to/your/desktop-app-binary
```

设置 shell 环境变量后，不要依赖从 Finder、Spotlight、Dock 或开始菜单启动。这些启动方式通常不会继承环境变量。

#### 4. 修改环境变量后完全重启

后端在进程启动时读取可观测性配置。如果你修改了 OTLP 环境变量，请完全停止应用并重新启动。

## 如何使用追踪和指标调试服务器

### 从本地追踪文件开始

追踪文件是检查原始 span 数据最快的方式。

实时查看：

```bash
tail -f "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

在 monorepo 开发环境中，使用：

```bash
tail -f ./dev/logs/server.trace.ndjson
```

显示失败的 span：

```bash
jq -c 'select(.exit._tag != "Success") | {
  name,
  durationMs,
  exit,
  attributes
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

显示慢 span：

```bash
jq -c 'select(.durationMs > 1000) | {
  name,
  durationMs,
  traceId,
  spanId
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

检查嵌入的日志事件：

```bash
jq -c 'select(any(.events[]?; .attributes["effect.logLevel"] != null)) | {
  name,
  durationMs,
  events: [
    .events[]
    | select(.attributes["effect.logLevel"] != null)
    | {
        message: .name,
        level: .attributes["effect.logLevel"]
      }
  ]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

追踪单个 trace：

```bash
jq -r 'select(.traceId == "TRACE_ID_HERE") | [
  .name,
  .spanId,
  (.parentSpanId // "-"),
  .durationMs
] | @tsv' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

过滤编排命令：

```bash
jq -c 'select(.attributes["orchestration.command_type"] != null) | {
  name,
  durationMs,
  commandType: .attributes["orchestration.command_type"],
  aggregateKind: .attributes["orchestration.aggregate_kind"]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

过滤 git 活动：

```bash
jq -c 'select(.attributes["git.operation"] != null) | {
  name,
  durationMs,
  operation: .attributes["git.operation"],
  cwd: .attributes["git.cwd"],
  hookEvents: [
    .events[]
    | select(.name == "git.hook.started" or .name == "git.hook.finished")
  ]
}' "$T3CODE_HOME/userdata/logs/server.trace.ndjson"
```

### 需要真正的追踪查看器时使用 Tempo

当需要以下操作时，Tempo 比原始 NDJSON 更好：

- 跨多个追踪搜索
- 可视化检查父子关系
- 比较多个慢追踪
- 深入分析单个失败请求，无需手动按 `traceId` 关联

在 Grafana 中的推荐流程：

1. 打开 `Explore`。
2. 选择 `Tempo` 数据源。
3. 将时间范围设置为最近的时间，如 `Last 15 minutes`。
4. 从宽泛的查询开始。不要一开始就使用非常窄的查询。
5. 查找你配置的服务名称的 span，然后按 span 名称或属性缩小范围。

推荐的首次搜索：

- 服务名称，如 `t3-local`、`t3-dev` 或 `t3-desktop`
- span 名称，如 `sql.execute`、`git.runCommand`、`provider.sendTurn`
- 带有 `orchestration.command_type` 等属性的编排 span

一旦确认追踪正在到达，更窄的 TraceQL 查询如 `name = "sql.execute"` 就会变得有用。

### 使用指标查看系统性问题

追踪最适合单个请求。指标最适合趋势分析。

值得关注的指标族：

- `t3_rpc_request_duration`
- `t3_orchestration_command_duration`
- `t3_orchestration_command_ack_duration`
- `t3_provider_turn_duration`
- `t3_git_command_duration`
- `t3_db_query_duration`

计数器告诉你请求量和失败率：

- `t3_rpc_requests_total`
- `t3_orchestration_commands_total`
- `t3_provider_turns_total`
- `t3_git_commands_total`
- `t3_db_queries_total`

当问题是以下情况时使用指标：

- "这个操作一直很慢吗？"
- "这个操作在修改后变差了吗？"
- "哪种命令类型失败最频繁？"

当问题是以下情况时使用追踪：

- "这个特定请求中发生了什么？"
- "哪个子 span 导致了这次慢交互？"
- "失败的流程中产生了哪些日志？"

### 新的 Ack 指标含义

`t3_orchestration_command_ack_duration` 测量：

- 开始：命令分发进入编排引擎
- 结束：该命令的第一个已提交领域事件由服务器发布

这是一个服务端确认指标。它不测量：

- websocket 传输到浏览器的时间
- 客户端接收时间
- React 渲染时间

如果以后需要这些，可以添加客户端埋点或专用的服务端分发指标。

## 常见工作流

### "为什么这个请求失败了？"

1. 从本地 NDJSON 文件开始。
2. 查找 `exit._tag != "Success"` 的 span。
3. 按 `traceId` 分组。
4. 检查兄弟 span 和 span 事件。
5. 如需要，切换到 Tempo 查看完整的追踪树。

### "为什么 UI 感觉很慢？"

1. 在追踪文件或 Tempo 中搜索慢的顶层 span。
2. 检查子 span 中的 sqlite、git、provider 或 terminal 操作。
3. 查看相应的耗时指标，判断慢是否是系统性的。

### "这个命令确认时间是否过长？"

1. 按 `commandType` 检查 `t3_orchestration_command_ack_duration`。
2. 如果值很高，检查相应的编排追踪。
3. 查看子 span 中的投影、sqlite、provider 或 git 操作。

### "git hooks 是否导致了延迟？"

1. 过滤 `git.operation` span。
2. 检查 `git.hook.started` 和 `git.hook.finished` 事件。
3. 比较 hook 耗时与外层 git span 的总耗时。

### "为什么本地有 span 但 Grafana 中没有？"

通常是以下原因之一：

- `T3CODE_OTLP_TRACES_URL` 未设置
- 应用从与导出环境变量不同的环境中启动
- 修改环境变量后应用未完全重启
- Grafana 查看的时间范围或服务名称不正确

如果本地 NDJSON 文件正在更新，说明本地追踪工作正常。问题几乎总是 OTLP 导出配置或进程启动问题。

## 如何为未来代码添加追踪

### 优先选择边界而非细粒度辅助函数

好的 span 边界：

- RPC 方法
- 编排命令处理
- Provider 适配器调用
- 外部进程调用
- 持久化写入
- 队列交接

避免追踪每个细小的辅助函数。大多数辅助函数应该继承活动的 span，而不是创建新的 span。

### 复用已有的 `Effect.fn(...)`

代码库已经大量使用 `Effect.fn("name")`。这通常应该是你的首选追踪边界。

对于临时工作：

```ts
import { Effect } from "effect";

const runThing = Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan({
    "thing.id": "abc123",
    "thing.kind": "example",
  });

  yield* Effect.logInfo("starting thing");
  return yield* doWork();
}).pipe(Effect.withSpan("thing.run"));
```

### 在 Span 上放置高基数详细信息

使用 span 注解添加 ID、路径和其他详细上下文：

```ts
yield *
  Effect.annotateCurrentSpan({
    "provider.thread_id": input.threadId,
    "provider.request_id": input.requestId,
    "git.cwd": input.cwd,
  });
```

### 保持指标标签低基数

好的指标标签：

- 操作类型
- 方法名称
- Provider 类型
- 聚合类型
- 结果

不好的指标标签：

- 原始线程 ID
- 命令 ID
- 文件路径
- 当前工作目录
- 完整的提示词
- 完整的模型字符串（当规范化的族标签可以满足时）

详细上下文应该放在 span 上，而不是指标上。

### 将日志作为 Span 事件使用

span 内的日志会成为追踪故事的一部分：

```ts
yield * Effect.logInfo("starting provider turn");
yield * Effect.logDebug("waiting for approval response");
```

这些消息会作为 span 事件显示，因为已安装 `Logger.tracerLogger`。

### 使用可链式调用的指标 API

`withMetrics(...)` 是为 effect 附加计数器和计时器的默认方式：

```ts
import { someCounter, someDuration, withMetrics } from "../observability/Metrics.ts";

const program = doWork().pipe(
  withMetrics({
    counter: someCounter,
    timer: someDuration,
    attributes: {
      operation: "work",
    },
  }),
);
```

## 详细 API 参考

### 运行时配置

服务器可观测性层在 `apps/server/src/observability/Layers/Observability.ts` 中组装。

它提供：

- 格式化的 stdout 日志器
- `Logger.tracerLogger`
- 本地 NDJSON 追踪器
- 可选的 OTLP 追踪导出器
- 可选的 OTLP 指标导出器
- Effect 追踪级别和计时引用

### 环境变量

本地追踪文件：

- `T3CODE_TRACE_FILE`：覆盖追踪文件路径
- `T3CODE_TRACE_MAX_BYTES`：单文件轮转大小，默认 `10485760`
- `T3CODE_TRACE_MAX_FILES`：轮转文件数量，默认 `10`
- `T3CODE_TRACE_BATCH_WINDOW_MS`：刷新窗口，默认 `200`
- `T3CODE_TRACE_MIN_LEVEL`：最小追踪级别，默认 `Info`
- `T3CODE_TRACE_TIMING_ENABLED`：启用计时元数据，默认 `true`

OTLP 导出：

- `T3CODE_OTLP_TRACES_URL`：OTLP 追踪端点
- `T3CODE_OTLP_METRICS_URL`：OTLP 指标端点
- `T3CODE_OTLP_EXPORT_INTERVAL_MS`：导出间隔，默认 `10000`
- `T3CODE_OTLP_SERVICE_NAME`：服务名称，默认 `t3-server`

如果未设置 OTLP URL，本地追踪仍然工作，指标仅保留在进程中。

### 当前已埋点的功能

当前高价值的 span 和指标边界包括：

- 来自 `effect/rpc` 的 Effect RPC websocket 请求 span
- `apps/server/src/observability/RpcInstrumentation.ts` 中的 RPC 请求指标
- 启动阶段
- 编排命令处理
- 编排命令确认延迟
- Provider 会话和 turn 操作
- Git 命令执行和 git hook 事件
- 终端会话生命周期
- SQLite 查询执行

### 当前限制

- span 外的日志不会被持久化
- 指标不会在本地快照
- 旧的 `serverLogPath` 仍然存在于配置中以保持兼容性，但追踪文件才是重要的持久化产物
