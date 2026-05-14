import { useCallback, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon } from "lucide-react";
import {
  useLayoutStore,
  useLayoutTemplates,
  useCurrentLayout,
  type LayoutMode,
  type PanelConfig,
} from "./layoutStore";

interface LayoutManagerProps {
  className?: string;
}

const MODE_ICONS: Record<LayoutMode, string> = {
  development: "💻",
  debug: "🐛",
  review: "👁️",
  custom: "⚙️",
};

const MODE_LABELS: Record<LayoutMode, string> = {
  development: "开发模式",
  debug: "调试模式",
  review: "审查模式",
  custom: "自定义",
};

const VISUAL_POSITIONS = ["left", "right", "bottom"] as const;
type VisualDockPosition = (typeof VISUAL_POSITIONS)[number];

const POSITION_SECTION_LABEL: Record<VisualDockPosition, string> = {
  left: "左侧栏",
  right: "右侧栏",
  bottom: "底部栏",
};

export function LayoutManager({ className = "" }: LayoutManagerProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [visualEditorEnabled, setVisualEditorEnabled] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [layoutDescription, setLayoutDescription] = useState("");

  const currentLayout = useCurrentLayout();
  const templates = useLayoutTemplates();
  const customLayouts = useLayoutStore((s) => s.customLayouts);
  const applyTemplate = useLayoutStore((s) => s.applyTemplate);
  const saveCustomLayout = useLayoutStore((s) => s.saveCustomLayout);
  const deleteCustomLayout = useLayoutStore((s) => s.deleteCustomLayout);
  const resetToDefault = useLayoutStore((s) => s.resetToDefault);
  const panels = useLayoutStore((s) => s.panels);
  const togglePanel = useLayoutStore((s) => s.togglePanel);

  const handleSaveLayout = () => {
    if (layoutName.trim()) {
      saveCustomLayout(layoutName.trim(), layoutDescription.trim());
      setLayoutName("");
      setLayoutDescription("");
      setShowSaveDialog(false);
    }
  };

  return (
    <div className={`relative flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">工作区布局</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSaveDialog(true)}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            保存布局
          </button>
          <button
            onClick={resetToDefault}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            重置
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Preset Templates */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">预设布局</h4>
          <div className="space-y-2">
            {templates
              .filter((t) => t.id !== "custom")
              .map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isActive={currentLayout.mode === template.id}
                  onSelect={() => applyTemplate(template.id)}
                />
              ))}
          </div>
        </div>

        {/* Custom Layouts */}
        {customLayouts.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-3">
              自定义布局
            </h4>
            <div className="space-y-2">
              {customLayouts.map((layout) => (
                <CustomLayoutCard
                  key={layout.id}
                  layout={layout}
                  isActive={currentLayout.mode === layout.id}
                  onSelect={() => applyTemplate(layout.id as LayoutMode)}
                  onDelete={() => deleteCustomLayout(layout.id)}
                />
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">可视化编排</h4>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={visualEditorEnabled}
                onChange={() => setVisualEditorEnabled((v) => !v)}
                className="h-3.5 w-3.5 rounded border-gray-300 dark:border-gray-600"
              />
              启用拖拽与尺寸
            </label>
          </div>
          {visualEditorEnabled ? (
            <div className="space-y-5">
              {VISUAL_POSITIONS.map((position) => (
                <div key={position}>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {POSITION_SECTION_LABEL[position]}
                  </p>
                  <PositionPanelSortList position={position} />
                </div>
              ))}
              <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
                在同一栏内拖拽把手调整顺序；滑块调节该栏内宽度或高度百分比（持久化到布局偏好）。
              </p>
            </div>
          ) : (
            <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
              开启后可按左 / 右 / 底分组拖拽面板顺序，并用滑块微调占比。
            </p>
          )}
        </div>

        {/* Panel Visibility */}
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">面板可见性</h4>
          <p className="text-[10px] text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
            「上下文 / 环境 /
            多代理」勾选表示在标题栏显示对应快捷按钮；侧栏内容由标题栏按钮单独开关，不会改动此处勾选。
          </p>
          <div className="space-y-2">
            {panels.map((panel) => (
              <PanelVisibilityItem
                key={panel.id}
                panel={panel}
                onToggle={() => togglePanel(panel.id)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 w-full max-w-sm">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
              保存自定义布局
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  布局名称
                </label>
                <input
                  type="text"
                  value={layoutName}
                  onChange={(e) => setLayoutName(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
                  placeholder="例如：我的工作区"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                  描述（可选）
                </label>
                <input
                  type="text"
                  value={layoutDescription}
                  onChange={(e) => setLayoutDescription(e.target.value)}
                  className="w-full text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
                  placeholder="简短描述这个布局的用途"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowSaveDialog(false)}
                className="text-xs px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                取消
              </button>
              <button
                onClick={handleSaveLayout}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  isActive,
  onSelect,
}: {
  template: { id: LayoutMode; name: string; description: string };
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full p-3 rounded-md text-left transition-colors ${
        isActive
          ? "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
          : "bg-gray-50 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:bg-gray-700/50"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-lg">{MODE_ICONS[template.id]}</span>
        <div>
          <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
            {template.name}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">{template.description}</div>
        </div>
      </div>
    </button>
  );
}

function CustomLayoutCard({
  layout,
  isActive,
  onSelect,
  onDelete,
}: {
  layout: { id: string; name: string; description: string };
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`p-3 rounded-md transition-colors ${
        isActive
          ? "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
          : "bg-gray-50 border border-gray-200 dark:bg-gray-800/50 dark:border-gray-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <button onClick={onSelect} className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="text-lg">{MODE_ICONS.custom}</span>
            <div>
              <div className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {layout.name}
              </div>
              {layout.description && (
                <div className="text-[10px] text-gray-500 dark:text-gray-400">
                  {layout.description}
                </div>
              )}
            </div>
          </div>
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 px-2"
        >
          删除
        </button>
      </div>
    </div>
  );
}

function PanelVisibilityItem({ panel, onToggle }: { panel: PanelConfig; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={panel.visible}
          onChange={onToggle}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600"
        />
        <span className="text-xs text-gray-900 dark:text-gray-100">{panel.title}</span>
      </div>
      <span className="text-[10px] text-gray-400 dark:text-gray-500">{panel.position}</span>
    </div>
  );
}

function SortablePanelRow({
  panel,
  positionKind,
}: {
  panel: PanelConfig;
  positionKind: VisualDockPosition;
}) {
  const resizePanel = useLayoutStore((s) => s.resizePanel);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: panel.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isBottom = positionKind === "bottom";
  const dimValue = Math.round(isBottom ? panel.height : panel.width);
  const onDimChange = (next: number) => {
    if (isBottom) {
      resizePanel(panel.id, panel.width, next);
    } else {
      resizePanel(panel.id, next, panel.height);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-md border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800/80 ${
        isDragging ? "z-10 opacity-80 shadow-md" : ""
      }`}
    >
      <button
        type="button"
        className="touch-none rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
        aria-label="拖拽排序"
        {...listeners}
        {...attributes}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      <span className="min-w-0 flex-1 truncate text-xs text-gray-900 dark:text-gray-100">
        {panel.title}
      </span>
      <label className="flex shrink-0 items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400">
        <span className="whitespace-nowrap">{isBottom ? "高度" : "宽度"}</span>
        <input
          type="range"
          min={10}
          max={95}
          value={dimValue}
          onChange={(e) => onDimChange(Number(e.target.value))}
          className="w-20 accent-blue-600 sm:w-24"
        />
        <span className="w-6 tabular-nums">{dimValue}%</span>
      </label>
    </div>
  );
}

function PositionPanelSortList({ position }: { position: VisualDockPosition }) {
  const panels = useLayoutStore((s) => s.panels);
  const reorderPanelsAtPosition = useLayoutStore((s) => s.reorderPanelsAtPosition);
  const sorted = useMemo(
    () => [...panels].filter((p) => p.position === position).toSorted((a, b) => a.order - b.order),
    [panels, position],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over === null || active.id === over.id) {
        return;
      }
      const oldIndex = sorted.findIndex((p) => p.id === active.id);
      const newIndex = sorted.findIndex((p) => p.id === over.id);
      if (oldIndex < 0 || newIndex < 0) {
        return;
      }
      reorderPanelsAtPosition(position, oldIndex, newIndex);
    },
    [sorted, position, reorderPanelsAtPosition],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-[10px] text-gray-400 dark:text-gray-500">当前预设下该栏无停靠面板。</p>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={sorted.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {sorted.map((panel) => (
            <SortablePanelRow key={panel.id} panel={panel} positionKind={position} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// Layout Switcher Button Component
export function LayoutSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const currentMode = useLayoutStore((s) => s.currentMode);
  const applyTemplate = useLayoutStore((s) => s.applyTemplate);
  const templates = useLayoutTemplates();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
      >
        <span>{MODE_ICONS[currentMode]}</span>
        <span>{MODE_LABELS[currentMode]}</span>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
            {templates.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  applyTemplate(template.id);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-gray-100 dark:hover:bg-gray-700 ${
                  currentMode === template.id
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-gray-700 dark:text-gray-300"
                }`}
              >
                <span>{MODE_ICONS[template.id as LayoutMode]}</span>
                <span>{template.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
