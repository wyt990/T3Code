import { useEffect, useState } from "react";
import type {
  DependencyUpdateSuggestion,
  EnvironmentTemplate,
  EnvironmentProfile,
  DependencyTree,
  DependencyAuditFinding,
} from "@t3tools/contracts";
import {
  useEnvironmentTemplates,
  useEnvironmentProfiles,
  useActiveEnvironmentProfile,
  useDependencyTree,
  useDependencyUpdateSuggestions,
  useDependencyAuditFindings,
  useEnvironmentStore,
} from "./environmentStore";

interface EnvironmentPanelProps {
  workspaceRoot?: string;
  className?: string;
}

export function EnvironmentPanel({ workspaceRoot, className = "" }: EnvironmentPanelProps) {
  const [activeTab, setActiveTab] = useState<"profiles" | "dependencies">("profiles");
  const templates = useEnvironmentTemplates();
  const profiles = useEnvironmentProfiles();
  const activeProfile = useActiveEnvironmentProfile();
  const tree = useDependencyTree();
  const dependencySuggestions = useDependencyUpdateSuggestions();
  const auditFindings = useDependencyAuditFindings();
  const isProfilesLoading = useEnvironmentStore((s) => s.isProfilesLoading);
  const createProfile = useEnvironmentStore((s) => s.createProfile);
  const switchEnvironment = useEnvironmentStore((s) => s.switchEnvironment);
  const refreshDependencies = useEnvironmentStore((s) => s.refreshDependencies);
  const fetchProfiles = useEnvironmentStore((s) => s.fetchProfiles);

  useEffect(() => {
    void fetchProfiles();
  }, [fetchProfiles]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">环境管理</h3>
        <button
          onClick={() => createProfile("新环境配置")}
          disabled={isProfilesLoading}
          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
        >
          新建配置
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <TabButton
          active={activeTab === "profiles"}
          onClick={() => setActiveTab("profiles")}
          label="环境配置"
        />
        <TabButton
          active={activeTab === "dependencies"}
          onClick={() => setActiveTab("dependencies")}
          label="依赖管理"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "profiles" && (
          <ProfilesTab
            profiles={profiles}
            activeProfile={activeProfile}
            templates={templates}
            onSwitch={switchEnvironment}
            onCreate={createProfile}
          />
        )}
        {activeTab === "dependencies" && (
          <DependenciesTab
            tree={tree}
            suggestions={dependencySuggestions}
            auditFindings={auditFindings}
            workspaceRoot={workspaceRoot ?? ""}
            onRefresh={refreshDependencies}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-blue-600 border-b-2 border-blue-600 dark:text-blue-400 dark:border-blue-400"
          : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
      }`}
    >
      {label}
    </button>
  );
}

function ProfilesTab({
  profiles,
  activeProfile,
  templates,
  onSwitch,
  onCreate,
}: {
  profiles: EnvironmentProfile[];
  activeProfile: EnvironmentProfile | null;
  templates: EnvironmentTemplate[];
  onSwitch: (environmentId: string) => Promise<void>;
  onCreate: (name: string, templateId?: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      {/* Templates Section */}
      <div>
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">环境模板</h4>
        <div className="grid grid-cols-2 gap-2">
          {templates.length === 0 ? (
            <div className="col-span-2 text-center py-4 text-xs text-gray-500 dark:text-gray-400">
              暂无模板
            </div>
          ) : (
            templates.map((template) => (
              <TemplateCard key={template.id} template={template} onCreate={onCreate} />
            ))
          )}
        </div>
      </div>

      {/* Profiles Section */}
      <div>
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">已保存的配置</h4>
        <div className="space-y-2">
          {profiles.length === 0 ? (
            <div className="text-center py-4 text-xs text-gray-500 dark:text-gray-400">
              暂无配置
            </div>
          ) : (
            profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                isActive={activeProfile?.id === profile.id}
                onSelect={() => onSwitch(profile.activeEnvironmentId)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onCreate,
}: {
  template: EnvironmentTemplate;
  onCreate: (name: string, templateId?: string) => Promise<void>;
}) {
  const typeColors: Record<string, string> = {
    development: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    testing: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    production: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    custom: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  };

  return (
    <div
      className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
      onClick={() => onCreate(template.name, template.id)}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
          {template.name}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${typeColors[template.type]}`}>
          {template.type === "development"
            ? "开发"
            : template.type === "testing"
              ? "测试"
              : template.type === "production"
                ? "生产"
                : "自定义"}
        </span>
      </div>
      {template.description && (
        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1">
          {template.description}
        </p>
      )}
    </div>
  );
}

function ProfileCard({
  profile,
  isActive,
  onSelect,
}: {
  profile: EnvironmentProfile;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`p-3 rounded-md cursor-pointer transition-colors ${
        isActive
          ? "bg-blue-50 border border-blue-200 dark:bg-blue-900/20 dark:border-blue-800"
          : "bg-gray-50 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800/50 dark:border-gray-700 dark:hover:bg-gray-700/50"
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{profile.name}</span>
        {isActive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">当前</span>
        )}
      </div>
      <div className="mt-1 text-[10px] text-gray-500 dark:text-gray-400">
        {Object.keys(profile.configs).length} 个环境
      </div>
    </div>
  );
}

function AuditSeverityBadge({ severity }: { severity: DependencyAuditFinding["severity"] }) {
  const styles: Record<DependencyAuditFinding["severity"], string> = {
    critical: "bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200",
    high: "bg-orange-200 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
    moderate: "bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
    low: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
    info: "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200",
  };
  const labels: Record<DependencyAuditFinding["severity"], string> = {
    critical: "严重",
    high: "高",
    moderate: "中",
    low: "低",
    info: "信息",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${styles[severity]}`}>
      {labels[severity]}
    </span>
  );
}

function DependenciesTab({
  tree,
  suggestions,
  auditFindings,
  workspaceRoot,
  onRefresh,
}: {
  tree: DependencyTree | null;
  suggestions: DependencyUpdateSuggestion[];
  auditFindings: DependencyAuditFinding[];
  workspaceRoot?: string;
  onRefresh: (workspaceRoot: string) => Promise<void>;
}) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!workspaceRoot) return;
    setIsRefreshing(true);
    await onRefresh(workspaceRoot);
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-4">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {tree ? `${tree.totalCount} 个依赖` : "未分析"}
        </span>
        {workspaceRoot && (
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
          >
            {isRefreshing ? "分析中..." : "分析依赖与安全"}
          </button>
        )}
      </div>

      {auditFindings.length > 0 && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950/30">
          <p className="text-[10px] font-medium text-rose-900 dark:text-rose-100">
            安全审计（npm / bun audit，{auditFindings.length} 条）
          </p>
          <ul className="mt-2 max-h-40 space-y-2 overflow-auto text-[10px] text-rose-900/95 dark:text-rose-100/90">
            {auditFindings.map((f) => {
              const stamp = [
                f.packageName,
                f.title,
                f.severity,
                f.range ?? "",
                f.detail ?? "",
                f.url ?? "",
              ].join("\u001f");
              return (
                <li
                  key={stamp}
                  className="border-b border-rose-100/80 pb-2 last:border-0 dark:border-rose-900/40"
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <AuditSeverityBadge severity={f.severity} />
                    <span className="font-mono font-medium">{f.packageName}</span>
                  </div>
                  <div className="mt-0.5">{f.title}</div>
                  {f.range ? (
                    <div className="mt-0.5 text-rose-800/80 dark:text-rose-200/80">
                      范围：{f.range}
                    </div>
                  ) : null}
                  {f.detail ? (
                    <div className="mt-0.5 text-rose-800/80 dark:text-rose-200/80 whitespace-pre-wrap">
                      {f.detail}
                    </div>
                  ) : null}
                  {f.url ? (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-0.5 inline-block text-blue-700 underline dark:text-blue-300"
                    >
                      参考链接
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          <p className="text-[10px] font-medium text-amber-900 dark:text-amber-100">
            版本范围提示（{suggestions.length}）
          </p>
          <ul className="mt-1 space-y-1 text-[10px] text-amber-900/90 dark:text-amber-100/90">
            {suggestions.map((s) => (
              <li key={s.packageName}>
                <span className="font-mono">{s.packageName}</span> — 当前 {s.currentVersion}，建议{" "}
                {s.suggestedVersion}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Dependency Tree */}
      {!tree ? (
        <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
          请点击「分析依赖与安全」扫描 package.json、浮动版本范围，并尝试 npm / bun audit。
        </div>
      ) : (
        <div className="space-y-2">
          {tree.nodes.map((node) => (
            <div
              key={node.name}
              className="p-2 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                  {node.name}
                </span>
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  v{node.version}
                </span>
              </div>
              {node.dependencies.length > 0 && (
                <div className="mt-2 pl-2 space-y-1">
                  {node.dependencies.slice(0, 10).map((dep) => (
                    <div key={dep.name} className="flex items-center justify-between text-[10px]">
                      <span className="text-gray-600 dark:text-gray-300">{dep.name}</span>
                      <span className="text-gray-400 dark:text-gray-500">{dep.version}</span>
                    </div>
                  ))}
                  {node.dependencies.length > 10 && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">
                      还有 {node.dependencies.length - 10} 个...
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
