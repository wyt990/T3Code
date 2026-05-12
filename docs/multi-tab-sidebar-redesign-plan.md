# 多标签侧边栏 + 顶部标签栏改造方案

## 1. 现状分析

### 当前布局结构

```
┌─────────────────────────────────────────────────┐
│ [Logo][Claude Code]        [状态图标]            │ ← SidebarHeader (sidebar 内部)
├──────────┬──────────────────────────────────────┤
│ Sidebar  │  [TabBar]                            │ ← TabBar 在 SidebarInset 内部
│ (项目/    │  [BranchToolbar]                     │ ← 分支/环境工具栏
│  会话树)  │  [ChatHeader (标题+操作按钮)]         │ ← 会话标题栏+按钮
│          │  [ChatView / Composer]                │ ← 聊天主体
│          │  [DiffPanel / Terminal]               │
├──────────┴──────────────────────────────────────┤
│ 设置 | 版本信息                                   │ ← SidebarFooter
└─────────────────────────────────────────────────┘
```

### 现有组件关系

| 组件                | 位置                                    | 用途                          |
| ------------------- | --------------------------------------- | ----------------------------- |
| `Sidebar.tsx`       | `AppSidebarLayout` → `Sidebar`          | 左侧项目/会话树               |
| `TabBar.tsx`        | `TabbedShell.tsx` → `SidebarInset` 顶部 | 水平会话标签条                |
| `TabbedShell.tsx`   | `_chat.$environmentId.$threadId` 等路由 | 标签容器+内容区               |
| `SidebarHeader`     | `Sidebar.tsx` 内部                      | Logo + 标题 (Electron 拖拽区) |
| `SidebarFooter`     | `Sidebar.tsx` 内部                      | 设置 + 版本                   |
| `ChatHeader.tsx`    | `ChatViewLoadedLayout`                  | 会话标题+操作按钮             |
| `BranchToolbar.tsx` | `ChatViewLoadedLayout`                  | 分支/环境选择器               |
| `uiTabsState.ts`    | `uiStateStore.ts`                       | 纯函数标签状态管理            |
| `uiStateStore.ts`   | Zustand store                           | 持久化 UI 状态                |

### Tab 系统已有能力（无需重建）

- `uiTabsState.ts`: `Tab`, `TabTarget`, `TabGroup`, `MergedTabPair` 类型和所有 reducer
- `TabBar.tsx`: 拖拽排序、合并、右键菜单、重命名
- `TabbedShell.tsx`: URL ↔ Tab 同步、Diff 面板管理
- `TabContentArea.tsx`: 多标签内容渲染、分屏

## 2. 目标布局

```
┌─────────────────────────────────────────────────┐
│ [Logo][Claude Code] [Tab1][Tab2][Tab3][+] [状态] │ ← 标签栏上移至此
├──────────┬──────────────────────────────────────┤
│ Sidebar  │  [ChatHeader (精简)]                  │ ← 移除 BranchToolbar 中部分功能
│ (标签式)  │  [ChatView / Composer]                │
│ ┌─技能┐┌───┐  │  [DiffPanel / Terminal]                │
│ │... ││项目│  │                                      │
│ └────┘└───┘  │                                      │
├──────────┴──────────────────────────────────────┤
│ 设置 | 版本信息                                   │
└─────────────────────────────────────────────────┘
```

### 关键变更

1. **TabBar 上移**：从 `TabbedShell` 移到 `AppSidebarLayout` 级别，放在 SidebarHeader 同一行的空白区域
2. **Sidebar 多标签化**：在侧边栏内部添加标签切换（技能/项目）
3. **移除顶部工具栏**：将 `BranchToolbar` 合并到 `ChatHeader` 或移除重复功能

## 3. 详细改造步骤

### Phase 1: 侧边栏多标签架构（SidebarTabBar）

#### 3.1 新建 `SidebarTabBar` 组件

**文件**: `apps/web/src/components/sidebar/SidebarTabBar.tsx`

侧边栏内部的垂直标签切换组件，类似 VS Code 侧边栏顶部的标签：

```tsx
// 简单标签切换，不涉及路由、不涉及拖拽
interface SidebarTab {
  id: string; // "skills" | "projects"
  label: string; // "技能" | "项目"
  icon: ReactNode;
}

interface SidebarTabBarProps {
  tabs: SidebarTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}
```

- 使用简单按钮组样式，与现有 sidebar 样式一致
- 无拖拽、无合并、无右键菜单
- 固定在 `SidebarContent` 顶部

#### 3.2 新增 `SidebarTabState`

**文件**: 在 `uiStateStore.ts` 中扩展现有 store，或新建

```typescript
// 侧边栏内部标签状态
interface SidebarTabState {
  activeSidebarTab: "skills" | "projects";
  setActiveSidebarTab: (tab: "skills" | "projects") => void;
}
```

与现有 `uiStateStore` 合并，使用 Zustand 的 `persist` 中间件。

### Phase 2: 项目标签内容

#### 3.3 提取现有项目列表为独立组件

**文件**: `apps/web/src/components/sidebar/SidebarProjectPanel.tsx`

从 `Sidebar.tsx` 中提取 `SidebarProjectsContent` 相关逻辑为独立组件：

```tsx
// 项目面板 - 作为侧边栏"项目"标签的内容
interface SidebarProjectPanelProps {
  // 从 Sidebar.tsx 提取现有的 props
}
```

主要内容：

- 项目列表（已有）
- 每个项目下的会话列表（已有）
- "添加项目"按钮 → 改为面板级别的 + 号按钮
- 右键菜单：添加会话、删除会话、重命名会话

#### 3.4 新增技能标签面板

**文件**: `apps/web/src/components/sidebar/SidebarSkillPanel.tsx`

```tsx
// 技能面板 - 作为侧边栏"技能"标签的内容
interface SidebarSkillPanelProps {
  // 定义技能列表的接口
}
```

技能面板从现有代码中提取技能相关 UI。

### Phase 3: 标签栏上移

#### 3.5 修改 `AppSidebarLayout`

**文件**: `apps/web/src/components/AppSidebarLayout.tsx`

将布局从：

```tsx
<SidebarProvider>
  <Sidebar>
    <ThreadSidebar />
  </Sidebar>
  {children} // ← children 中包含 TabbedShell → TabBar
</SidebarProvider>
```

改为：

```tsx
<SidebarProvider>
  <div className="flex h-dvh w-full flex-col">
    {/* 顶部栏：logo + 标签栏 + 状态 */}
    <header className="flex h-[52px] shrink-0 items-stretch border-b border-border">
      {/* 左侧：logo 区域（与 sidebar 联动） */}
      <div className="flex w-(--sidebar-width) shrink-0 items-center px-4 drag-region">
        <Logo />
      </div>
      {/* 中间：TabBar */}
      <div className="flex min-w-0 flex-1 items-stretch">
        <MainTabBar /> {/* 此处插入 TabBar */}
      </div>
      {/* 右侧：状态图标 */}
      <div className="flex shrink-0 items-center px-4">
        <StatusIcons />
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <Sidebar>
        <ThreadSidebarWithTabs />
      </Sidebar>
      <SidebarInset>
        {children} {/* TabbedShell 内部不再包含 TabBar */}
      </SidebarInset>
    </div>
  </div>
</SidebarProvider>
```

#### 3.6 新建 `MainTabBar` 顶层容器

**文件**: `apps/web/src/components/TabBar/MainTabBar.tsx`

封装 `TabBar` 组件，提供与 `AppSidebarLayout` 的接口：

```tsx
// 从 uiStateStore 读取标签状态
// 渲染 TabBar 组件
// 处理新建标签、关闭标签等操作
```

### Phase 4: 移除/精简顶部工具栏

#### 3.7 将 `ChatHeader` 与 `BranchToolbar` 合并简化

- 移除 `BranchToolbar` 的独立行
- 将分支/环境选择器移到 `ChatHeader` 左侧
- 移除 `SidebarTrigger` 按钮（侧边栏由标签栏管理）
- 保留终端/Diff 切换按钮

### Phase 5: 右键菜单增强

#### 3.8 在项目标签中增加右键菜单

在 `SidebarProjectPanel` 中为项目和会话添加右键菜单：

- 项目：添加会话、从侧边栏移除项目（非物理删除）
- 会话：打开在新标签、重命名、删除、归档

#### 3.9 右键菜单逻辑提取

**文件**: `apps/web/src/components/sidebar/sidebarContextMenu.ts`

将右键菜单逻辑提取为独立模块，方便测试和复用。

## 4. 文件变更清单

### 新增文件

| 文件                                                      | 用途                          |
| --------------------------------------------------------- | ----------------------------- |
| `apps/web/src/components/sidebar/SidebarTabBar.tsx`       | 侧边栏内部标签切换            |
| `apps/web/src/components/sidebar/SidebarProjectPanel.tsx` | 从 Sidebar.tsx 提取的项目面板 |
| `apps/web/src/components/sidebar/SidebarSkillPanel.tsx`   | 技能面板                      |
| `apps/web/src/components/TabBar/MainTabBar.tsx`           | 顶部标签栏容器                |
| `apps/web/src/components/sidebar/sidebarContextMenu.ts`   | 侧边栏右键菜单逻辑            |
| `apps/web/src/sidebarTabState.ts`                         | 侧边栏标签状态 (Zustand)      |

### 修改文件

| 文件                                             | 修改内容                                   |
| ------------------------------------------------ | ------------------------------------------ |
| `apps/web/src/components/AppSidebarLayout.tsx`   | 重构布局结构，TabBar 上移                  |
| `apps/web/src/components/TabBar/TabbedShell.tsx` | 移除 TabBar 引用，只保留 TabContentArea    |
| `apps/web/src/components/Sidebar.tsx`            | 提取项目面板为独立组件，集成 SidebarTabBar |
| `apps/web/src/uiStateStore.ts`                   | 增加侧边栏标签状态                         |
| `apps/web/src/routes/__root.tsx`                 | 适配新布局结构                             |

## 5. 与现有系统的兼容性

### Tab 系统无破坏性变更

- `uiTabsState.ts` 的所有 reducer 保持不变
- `TabBar.tsx` 组件接口保持不变
- `TabBar.logic.ts` 标题解析逻辑不变
- `TabbedShell.tsx` 仅移除 TabBar 渲染，TabContentArea 不变

### 状态管理

- 现有 `uiStateStore` 的 `tabs` 字段保持不变
- 新增 `sidebarTab` 字段（可选持久化）
- 侧边栏展开/折叠状态保持不变

### 路由系统

- URL 驱动标签激活的逻辑不变
- `useUrlTargetSync` 逻辑不变
- 仅在 `TabbedShell` 中移除 TabBar 渲染

## 6. 样式指南

### 顶部标签栏

- 高度: `h-[52px]`（匹配现有 titlebar 高度）
- 背景: `bg-background/80` 配合 `backdrop-blur`
- 标签样式与现有 `TabBar.tsx` 一致
- Electron 中 `drag-region` 保留在 logo 区域和标签栏右侧空白区

### 侧边栏标签切换

- 使用 `SidebarGroup` 内的按钮组
- 激活标签: `bg-sidebar-accent text-sidebar-accent-foreground`
- 非激活标签: `text-sidebar-foreground/70 hover:bg-sidebar-accent/50`
- 标签下方有 `border-b` 或 `underline` 指示器

### 项目面板

- 保留现有 `SidebarProjectsContent` 的样式
- 项目标题可点击展开会话列表
- 会话项右键菜单使用 `contextMenuFallback.ts`（浏览器）或 native（Electron）

## 7. 实施顺序

1. **Phase 1**: 创建 `SidebarTabBar` + `sidebarTabState` → 侧边栏可切换标签
2. **Phase 2**: 提取 `SidebarProjectPanel` + 创建 `SidebarSkillPanel` → 填充标签内容
3. **Phase 3**: 创建 `MainTabBar` + 修改 `AppSidebarLayout` → TabBar 上移
4. **Phase 4**: 修改 `TabbedShell` 移除 TabBar → 清理
5. **Phase 5**: 增强右键菜单 → 完成交互

每个 phase 完成后验证 `bun run typecheck` 和 `bun run test` 通过。
