import { useState } from "react";
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

export function LayoutManager({ className = "" }: LayoutManagerProps) {
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [layoutName, setLayoutName] = useState("");
  const [layoutDescription, setLayoutDescription] = useState("");

  const currentLayout = useCurrentLayout();
  const templates = useLayoutTemplates();
  const customLayouts = useLayoutStore((s) => s.customLayouts);
  const setCurrentMode = useLayoutStore((s) => s.setCurrentMode);
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
