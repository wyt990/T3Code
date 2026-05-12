import { useCallback, useEffect, useState } from "react";
import type {
  TestCase,
  RegressionTestSelection,
  TestSuite,
  FileCoverage,
  WeakArea,
  ProjectId,
} from "@t3tools/contracts";
import type { CoverageReportType } from "./testStore";
import {
  useTestStore,
  useTestSuites,
  useLatestCoverageReport,
  useRegressionSelection,
  useLastTestRun,
} from "./testStore";

interface TestCoveragePanelProps {
  className?: string;
  projectId?: ProjectId;
  workspaceRoot?: string;
}

const STATUS_COLORS: Record<TestCase["status"], string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  generated: "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400",
  verified: "bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400",
};

const STATUS_LABELS: Record<TestCase["status"], string> = {
  draft: "草稿",
  generated: "已生成",
  verified: "已验证",
  failed: "失败",
};

export function TestCoveragePanel({
  className = "",
  projectId,
  workspaceRoot,
}: TestCoveragePanelProps) {
  const [activeTab, setActiveTab] = useState<"suites" | "coverage" | "regression">("suites");
  const [covWeakMaxPct, setCovWeakMaxPct] = useState(50);
  const [covLinesMinPct, setCovLinesMinPct] = useState<number | null>(null);
  const suites = useTestSuites();
  const coverageReport = useLatestCoverageReport();
  const regressionSelection = useRegressionSelection();
  const isGenerating = useTestStore((s) => s.isGenerating);
  const generateTests = useTestStore((s) => s.generateTests);
  const fetchCoverageReport = useTestStore((s) => s.fetchCoverageReport);

  const coverageFetchOpts = useCallback((): {
    weakAreaMaxLinesPercent: number;
    linesCoverageMinPercent?: number;
  } => {
    return {
      weakAreaMaxLinesPercent: Math.min(99, Math.max(1, Math.round(covWeakMaxPct))),
      ...(covLinesMinPct !== null
        ? { linesCoverageMinPercent: Math.min(100, Math.max(0, Math.round(covLinesMinPct))) }
        : {}),
    };
  }, [covWeakMaxPct, covLinesMinPct]);

  useEffect(() => {
    if (!projectId || !workspaceRoot?.trim()) {
      return;
    }
    void fetchCoverageReport(projectId, workspaceRoot, coverageFetchOpts());
  }, [projectId, workspaceRoot, fetchCoverageReport, coverageFetchOpts]);

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">测试管理</h3>
        <div className="flex items-center gap-2">
          {projectId && workspaceRoot?.trim() ? (
            <button
              type="button"
              onClick={() =>
                void fetchCoverageReport(projectId, workspaceRoot, coverageFetchOpts())
              }
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              刷新覆盖率
            </button>
          ) : null}
          <span className="text-xs text-gray-500 dark:text-gray-400">{suites.length} 套件</span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-1 p-2 border-b border-gray-200 dark:border-gray-700">
        <StatBadge
          count={suites.reduce((acc, s) => acc + s.testCases.length, 0)}
          label="测试用例"
          color="blue"
        />
        <StatBadge
          count={coverageReport?.summary.lines ? Math.round(coverageReport.summary.lines * 100) : 0}
          label="行覆盖率"
          unit="%"
          color="green"
        />
        <StatBadge
          count={
            coverageReport?.summary.branches ? Math.round(coverageReport.summary.branches * 100) : 0
          }
          label="分支覆盖率"
          unit="%"
          color="yellow"
        />
        <StatBadge
          count={regressionSelection?.selectedTests.length || 0}
          label="回归测试"
          color="purple"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <TabButton
          active={activeTab === "suites"}
          onClick={() => setActiveTab("suites")}
          label="测试套件"
        />
        <TabButton
          active={activeTab === "coverage"}
          onClick={() => setActiveTab("coverage")}
          label="覆盖率"
        />
        <TabButton
          active={activeTab === "regression"}
          onClick={() => setActiveTab("regression")}
          label="回归测试"
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === "suites" && (
          <TestSuitesTab suites={suites} isGenerating={isGenerating} onGenerate={generateTests} />
        )}
        {activeTab === "coverage" && (
          <CoverageTab
            report={coverageReport}
            hasWorkspace={Boolean(projectId && workspaceRoot?.trim())}
            weakAreaMaxPct={covWeakMaxPct}
            onWeakAreaMaxPctChange={setCovWeakMaxPct}
            linesMinPct={covLinesMinPct}
            onLinesMinPctChange={setCovLinesMinPct}
          />
        )}
        {activeTab === "regression" && (
          <RegressionTab
            selection={regressionSelection}
            {...(workspaceRoot !== undefined && workspaceRoot.trim().length > 0
              ? { workspaceRoot }
              : {})}
          />
        )}
      </div>
    </div>
  );
}

function StatBadge({
  count,
  label,
  color,
  unit = "",
}: {
  count: number;
  label: string;
  color: "blue" | "green" | "yellow" | "purple";
  unit?: string;
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
    green: "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400",
    yellow: "bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400",
    purple: "bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400",
  };

  return (
    <div className={`text-center py-2 rounded ${colorClasses[color]}`}>
      <div className="text-lg font-semibold">
        {count}
        {unit}
      </div>
      <div className="text-[10px]">{label}</div>
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

function TestSuitesTab({
  suites,
  isGenerating,
  onGenerate,
}: {
  suites: TestSuite[];
  isGenerating: boolean;
  onGenerate: (targetFile: string) => Promise<void>;
}) {
  const [targetFile, setTargetFile] = useState("");

  const handleGenerate = async () => {
    if (targetFile.trim()) {
      await onGenerate(targetFile.trim());
      setTargetFile("");
    }
  };

  return (
    <div className="space-y-4">
      {/* Generate Tests */}
      <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">生成测试</h4>
        <div className="flex gap-2">
          <input
            type="text"
            value={targetFile}
            onChange={(e) => setTargetFile(e.target.value)}
            placeholder="输入目标文件路径..."
            className="flex-1 text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700"
          />
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !targetFile.trim()}
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isGenerating ? "生成中..." : "生成"}
          </button>
        </div>
      </div>

      {/* Suites List */}
      <div>
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">测试套件</h4>
        <div className="space-y-2">
          {suites.length === 0 ? (
            <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
              暂无测试套件
            </div>
          ) : (
            suites.map((suite) => <SuiteCard key={suite.id} suite={suite} />)
          )}
        </div>
      </div>
    </div>
  );
}

function SuiteCard({ suite }: { suite: TestSuite }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">{suite.name}</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {suite.testCases.length} 用例
        </span>
      </div>

      {expanded && suite.testCases.length > 0 && (
        <div className="mt-3 space-y-1">
          {suite.testCases.map((test) => (
            <div
              key={test.id}
              className="flex items-center justify-between py-1 px-2 rounded bg-white dark:bg-gray-700"
            >
              <span className="text-[10px] text-gray-700 dark:text-gray-300 truncate">
                {test.name}
              </span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[test.status]}`}>
                {STATUS_LABELS[test.status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CoverageTab({
  report,
  hasWorkspace,
  weakAreaMaxPct,
  onWeakAreaMaxPctChange,
  linesMinPct,
  onLinesMinPctChange,
}: {
  report: CoverageReportType | null;
  hasWorkspace: boolean;
  weakAreaMaxPct: number;
  onWeakAreaMaxPctChange: (n: number) => void;
  linesMinPct: number | null;
  onLinesMinPctChange: (n: number | null) => void;
}) {
  if (!hasWorkspace) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
        请先打开某个项目下的会话，以便解析工作区内的 Vitest
        覆盖率文件（coverage/coverage-summary.json）。
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
        暂无覆盖率报告
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 space-y-2">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">阈值与薄弱区</h4>
        <div className="flex flex-wrap items-end gap-3 text-[10px]">
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500 dark:text-gray-400">薄弱文件阈值（%）</span>
            <input
              type="number"
              min={1}
              max={99}
              value={weakAreaMaxPct}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (Number.isFinite(n)) {
                  onWeakAreaMaxPctChange(Math.min(99, Math.max(1, n)));
                }
              }}
              className="w-20 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-700"
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-gray-500 dark:text-gray-400">行覆盖率门禁（%）</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                placeholder="关闭"
                value={linesMinPct === null ? "" : linesMinPct}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  if (v === "") {
                    onLinesMinPctChange(null);
                    return;
                  }
                  const n = Number.parseInt(v, 10);
                  onLinesMinPctChange(Number.isFinite(n) ? n : null);
                }}
                className="w-24 border border-gray-300 dark:border-gray-600 rounded px-1 py-0.5 bg-white dark:bg-gray-700"
              />
            </div>
          </label>
        </div>
        <p className="text-[10px] text-gray-500 dark:text-gray-400">
          修改后自动重新拉取覆盖率；门禁开启时将在下方显示是否达标。
        </p>
      </div>

      {/* Summary */}
      {report.linesThresholdGate ? (
        <div
          className={`p-3 rounded-md border text-[11px] ${
            report.linesThresholdGate.passed
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100"
              : "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100"
          }`}
        >
          <div className="font-medium">
            行覆盖率门禁：要求 ≥ {report.linesThresholdGate.linesMinPercent}% ，实际{" "}
            {report.linesThresholdGate.actualLinesPercent}% —{" "}
            {report.linesThresholdGate.passed ? "通过" : "未通过"}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="p-2 rounded bg-blue-50 dark:bg-blue-900/20 text-center">
          <div className="text-lg font-semibold text-blue-600 dark:text-blue-400">
            {Math.round(report.summary.lines * 100)}%
          </div>
          <div className="text-[10px] text-gray-600 dark:text-gray-400">行覆盖率</div>
        </div>
        <div className="p-2 rounded bg-green-50 dark:bg-green-900/20 text-center">
          <div className="text-lg font-semibold text-green-600 dark:text-green-400">
            {Math.round(report.summary.functions * 100)}%
          </div>
          <div className="text-[10px] text-gray-600 dark:text-gray-400">函数覆盖率</div>
        </div>
      </div>

      {/* Files */}
      <div>
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">文件覆盖率</h4>
        <div className="space-y-2">
          {report.files.map((file: FileCoverage) => (
            <div key={file.path} className="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-gray-700 dark:text-gray-300 truncate">
                  {file.path}
                </span>
                <span className="text-[10px] font-medium text-gray-900 dark:text-gray-100">
                  {Math.round(file.lines * 100)}%
                </span>
              </div>
              <div className="mt-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full">
                <div
                  className="h-1 bg-blue-600 rounded-full"
                  style={{ width: `${file.lines * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Weak Areas */}
      {report.weakAreas.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">薄弱区域</h4>
          <div className="space-y-2">
            {report.weakAreas.map((area: WeakArea) => (
              <div
                key={area.path}
                className="p-2 rounded bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800"
              >
                <div className="text-[10px] text-yellow-800 dark:text-yellow-300">{area.path}</div>
                <div className="text-[10px] text-yellow-600 dark:text-yellow-400">
                  {area.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RegressionTab({
  workspaceRoot,
  selection,
}: {
  workspaceRoot?: string;
  selection: RegressionTestSelection | null;
}) {
  const [changedInput, setChangedInput] = useState(
    "apps/server/src/testing/discoverRegressionCandidates.ts",
  );
  const runRegressionTests = useTestStore((s) => s.runRegressionTests);
  const executeWorkspaceTests = useTestStore((s) => s.executeWorkspaceTests);
  const isSelectingRegression = useTestStore((s) => s.isSelectingRegression);
  const isRunningWorkspaceTests = useTestStore((s) => s.isRunningWorkspaceTests);
  const lastTestRun = useLastTestRun();

  const parseChangedFiles = (raw: string): string[] =>
    raw
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  if (!workspaceRoot?.trim()) {
    return (
      <div className="text-center py-8 text-sm text-gray-500 dark:text-gray-400">
        请先打开某个项目下的会话，以便在工作区根路径上扫描测试并运行 vitest。
      </div>
    );
  }

  const wr = workspaceRoot.trim();

  return (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
          变更文件列表（相对工作区根，每行一个或用逗号分隔）
        </h4>
        <textarea
          value={changedInput}
          onChange={(e) => setChangedInput(e.target.value)}
          rows={4}
          className="w-full text-xs border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-700 font-mono"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isSelectingRegression}
            onClick={() => void runRegressionTests(parseChangedFiles(changedInput), wr)}
            className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {isSelectingRegression ? "分析中…" : "分析回归"}
          </button>
          <button
            type="button"
            disabled={
              isRunningWorkspaceTests || !selection || selection.selectedTests.length === 0 || !wr
            }
            onClick={() => {
              if (!selection) {
                return;
              }
              void executeWorkspaceTests({
                id: `workbench-${Date.now()}`,
                name: "工作台回归子集",
                testFiles: [...selection.selectedTests],
                parallel: false,
                timeout: 600_000,
                environment: {},
                coverage: false,
                coverageThreshold: 0,
                workspaceRoot: wr,
              });
            }}
            className="text-xs px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {isRunningWorkspaceTests ? "运行中…" : "运行选中测试 (vitest)"}
          </button>
        </div>
      </div>

      {!selection ? (
        <div className="text-center py-4 text-sm text-gray-500 dark:text-gray-400">
          点击「分析回归」后在此查看匹配结果。
        </div>
      ) : (
        <>
          <div className="p-3 rounded-md bg-gray-50 dark:bg-gray-800/50">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500 dark:text-gray-400">置信度</span>
              <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
                {Math.round(selection.confidence * 100)}%
              </span>
            </div>
            <div className="mt-2 h-2 bg-gray-200 dark:bg-gray-700 rounded-full">
              <div
                className="h-2 bg-blue-600 rounded-full"
                style={{ width: `${selection.confidence * 100}%` }}
              />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              变更文件 ({selection.changedFiles.length})
            </h4>
            <div className="space-y-1">
              {selection.changedFiles.map((file) => (
                <div
                  key={file}
                  className="text-[10px] text-gray-600 dark:text-gray-400 px-2 py-1 bg-gray-100 dark:bg-gray-800 rounded"
                >
                  {file}
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
              选中测试 ({selection.selectedTests.length})
            </h4>
            <div className="space-y-1 max-h-48 overflow-auto">
              {selection.selectedTests.map((test) => (
                <div
                  key={test}
                  className="text-[10px] text-gray-600 dark:text-gray-400 px-2 py-1 bg-blue-50 dark:bg-blue-900/20 rounded font-mono"
                >
                  {test}
                </div>
              ))}
            </div>
          </div>

          <div className="p-2 rounded bg-gray-50 dark:bg-gray-800/50">
            <span className="text-[10px] text-gray-500 dark:text-gray-400">{selection.reason}</span>
          </div>
        </>
      )}

      {lastTestRun ? (
        <div className="p-3 rounded-md border border-gray-200 dark:border-gray-700">
          <h4 className="text-xs font-medium text-gray-700 dark:text-gray-200 mb-1">
            上次运行结果
          </h4>
          <div className="text-[10px] text-gray-600 dark:text-gray-400 space-y-1">
            <div>状态：{lastTestRun.status}</div>
            <div>耗时：{lastTestRun.duration} ms</div>
            <div>
              用例：共 {lastTestRun.testsRun}，通过 {lastTestRun.testsPassed}，失败{" "}
              {lastTestRun.testsFailed}
            </div>
            {lastTestRun.failures.length > 0 ? (
              <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-red-600 dark:text-red-400">
                {lastTestRun.failures[0]?.message}
              </pre>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
