"use client";

import type {
  BestPracticeChecklist,
  BestPracticeChecklistItem,
  ProjectId,
  ProjectStyleProfile,
  TechDebtItem,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";
import { useCodeQualityGateStore } from "../codeQualityGateStore";

function defaultCodeQualityChecklist(projectId: string): BestPracticeChecklist {
  const now = new Date().toISOString();
  return {
    id: `checklist-${projectId}`,
    projectId,
    name: "基础实践",
    items: [
      {
        id: "err",
        description: "包含错误处理（try/catch）",
        category: "可靠性",
        required: true,
        checked: false,
      },
      {
        id: "doc",
        description: "包含文档注释 /** */",
        category: "文档",
        required: false,
        checked: false,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

interface CodeQualityPanelProps {
  readonly projectId: ProjectId;
  readonly className?: string;
}

export function CodeQualityPanel({ projectId, className = "" }: CodeQualityPanelProps) {
  const client = readPrimaryWsRpcClient();
  const projectIdStr = String(projectId);

  const [checklist, setChecklist] = useState<BestPracticeChecklist>(() =>
    defaultCodeQualityChecklist(projectIdStr),
  );
  const checklistRef = useRef(checklist);
  checklistRef.current = checklist;

  const { turnStartGateMode, minScorePerSnippet, setTurnStartGateMode, setMinScorePerSnippet } =
    useCodeQualityGateStore(
      useShallow((s) => ({
        turnStartGateMode: s.turnStartGateMode,
        minScorePerSnippet: s.minScorePerSnippet,
        setTurnStartGateMode: s.setTurnStartGateMode,
        setMinScorePerSnippet: s.setMinScorePerSnippet,
      })),
    );

  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [profile, setProfile] = useState<ProjectStyleProfile | null>(null);
  const [debt, setDebt] = useState<TechDebtItem[]>([]);
  const [checkScore, setCheckScore] = useState<number | null>(null);
  const [checkIssues, setCheckIssues] = useState<string>("");
  const [validatePassed, setValidatePassed] = useState<boolean | null>(null);
  const [validateViolations, setValidateViolations] = useState<string[]>([]);
  const [code, setCode] = useState(`export function example() {\n  return 1;\n}\n`);
  const [filePath, setFilePath] = useState("src/example.ts");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) {
      setPrefsLoaded(false);
      return;
    }
    setPrefsLoaded(false);
    setChecklist(defaultCodeQualityChecklist(projectIdStr));
    let cancelled = false;
    void (async () => {
      try {
        const p = await client.codeQuality.getProjectPreferences({ projectId: projectIdStr });
        if (cancelled) {
          return;
        }
        setTurnStartGateMode(p.turnStartGateMode);
        setMinScorePerSnippet(p.minScorePerSnippet);
        if (p.checklist) {
          setChecklist(p.checklist);
        } else {
          setChecklist(defaultCodeQualityChecklist(projectIdStr));
        }
        setPrefsLoaded(true);
      } catch {
        if (!cancelled) {
          setPrefsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, projectIdStr, setMinScorePerSnippet, setTurnStartGateMode]);

  useEffect(() => {
    if (!client || !prefsLoaded) {
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        try {
          const now = new Date().toISOString();
          const c = checklistRef.current;
          await client.codeQuality.setProjectPreferences({
            projectId: projectIdStr,
            preferences: {
              turnStartGateMode,
              minScorePerSnippet,
              checklist: { ...c, projectId: projectIdStr, updatedAt: now },
            },
          });
        } catch {
          /* best-effort sync */
        }
      })();
    }, 500);
    return () => clearTimeout(t);
  }, [client, prefsLoaded, projectIdStr, turnStartGateMode, minScorePerSnippet]);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      if (!client) {
        setError("WebSocket 未连接");
        return;
      }
      setBusy(label);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [client],
  );

  const saveChecklistOnly = useCallback(() => {
    void run("保存清单", async () => {
      const now = new Date().toISOString();
      const next = { ...checklistRef.current, projectId: projectIdStr, updatedAt: now };
      await client!.codeQuality.setProjectPreferences({
        projectId: projectIdStr,
        preferences: {
          turnStartGateMode,
          minScorePerSnippet,
          checklist: next,
        },
      });
      setChecklist(next);
    });
  }, [client, projectIdStr, run, turnStartGateMode, minScorePerSnippet]);

  const patchChecklistItem = useCallback(
    (itemId: string, patch: Partial<BestPracticeChecklistItem>) => {
      setChecklist((prev) => {
        const now = new Date().toISOString();
        return {
          ...prev,
          updatedAt: now,
          items: prev.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
        };
      });
    },
    [],
  );

  return (
    <div className={`flex flex-col h-full ${className}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">代码质量</h3>
        {busy && <span className="text-[10px] text-gray-500 dark:text-gray-400">{busy}…</span>}
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <section className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">生成链路闸门</h4>
          <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-relaxed">
            发送回合前：扫描消息中的 Markdown
            围栏代码块并打分；拦截或仅告警由模式决定。回合结束后：对本轮 diff
            中的文本类文件做质检（阈值与下方「代码块最低分」一致），未达标时在时间线写入「code-quality.post-turn」活动。偏好持久化在服务器{" "}
            <span className="font-mono">userdata/code-quality-project-preferences.json</span>。
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                { id: "off" as const, label: "关闭" },
                { id: "warn" as const, label: "仅告警" },
                { id: "block" as const, label: "拦截" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTurnStartGateMode(opt.id)}
                className={`text-[10px] rounded px-2 py-1 border ${
                  turnStartGateMode === opt.id
                    ? "border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950/50 dark:text-blue-100 dark:border-blue-500"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-[10px] text-gray-700 dark:text-gray-300">
            <span>代码块最低分阈值（0–100）</span>
            <input
              type="number"
              min={0}
              max={100}
              value={minScorePerSnippet}
              onChange={(e) => setMinScorePerSnippet(Number(e.target.value))}
              className="w-24 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
            />
          </label>
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">项目风格</h4>
          <button
            type="button"
            disabled={!client || busy !== null}
            onClick={() =>
              void run("学习风格", async () => {
                const { profile: next } = await client!.codeQuality.learnProjectStyle({
                  projectId: projectIdStr,
                });
                setProfile(next);
              })
            }
            className="text-xs rounded-md bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
          >
            从项目采样学习风格
          </button>
          {profile && (
            <p className="text-[10px] text-gray-600 dark:text-gray-300">
              已缓存档案：{profile.patterns.length} 条模式 / {profile.rules.length} 条规则
            </p>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">技术债扫描</h4>
          <button
            type="button"
            disabled={!client || busy !== null}
            onClick={() =>
              void run("技术债", async () => {
                const { debt: items } = await client!.codeQuality.detectTechDebt({
                  projectId: projectIdStr,
                });
                setDebt([...items]);
              })
            }
            className="text-xs rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            运行启发式检测
          </button>
          {debt.length > 0 && (
            <ul className="text-[10px] space-y-1 text-gray-700 dark:text-gray-300">
              {debt.map((d) => (
                <li key={d.id}>
                  <span className="font-mono text-gray-500">
                    {d.filePath}:{d.line}
                  </span>{" "}
                  — {d.description} <span className="text-gray-400">({d.severity})</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">片段检查</h4>
          <input
            value={filePath}
            onChange={(e) => setFilePath(e.target.value)}
            className="w-full text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
            placeholder="文件路径"
          />
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={8}
            className="w-full text-xs font-mono rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1"
          />
          <button
            type="button"
            disabled={!client || busy !== null || !profile}
            onClick={() =>
              void run("检查代码", async () => {
                const { result } = await client!.codeQuality.checkCode({
                  code,
                  filePath,
                  profile: profile!,
                });
                setCheckScore(result.score);
                setCheckIssues(result.issues.map((i) => `${i.line}:${i.message}`).join("\n"));
              })
            }
            className="text-xs rounded-md bg-blue-600 text-white px-3 py-1.5 hover:bg-blue-700 disabled:opacity-50"
          >
            对照当前风格检查
          </button>
          {!profile && (
            <p className="text-[10px] text-amber-700 dark:text-amber-300">
              请先执行「学习风格」以生成档案。
            </p>
          )}
          {checkScore !== null && (
            <div className="text-[10px] space-y-1">
              <p className="font-medium text-gray-800 dark:text-gray-100">得分：{checkScore}</p>
              {checkIssues && (
                <pre className="whitespace-pre-wrap text-gray-600 dark:text-gray-300">
                  {checkIssues}
                </pre>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2 rounded-md border border-gray-200 dark:border-gray-700 p-3">
          <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">最佳实践清单</h4>
          <p className="text-[10px] text-gray-600 dark:text-gray-400 leading-relaxed">
            清单按项目保存在服务器；修改「必填 / 已对照」后点「保存清单」；闸门模式与阈值会在约 0.5s
            内自动同步（含当前清单副本）。
          </p>
          <ul className="space-y-2 text-[10px] text-gray-700 dark:text-gray-300">
            {checklist.items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-2 border-b border-gray-100 pb-2 dark:border-gray-800"
              >
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(e) => patchChecklistItem(item.id, { required: e.target.checked })}
                  />
                  必填
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => patchChecklistItem(item.id, { checked: e.target.checked })}
                  />
                  已对照
                </label>
                <span>{item.description}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            disabled={!client || busy !== null || !prefsLoaded}
            onClick={saveChecklistOnly}
            className="text-xs rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            保存清单到服务器
          </button>
          <button
            type="button"
            disabled={!client || busy !== null}
            onClick={() =>
              void run("清单校验", async () => {
                const res = await client!.codeQuality.validateBestPractices({
                  code,
                  checklist,
                });
                setValidatePassed(res.passed);
                setValidateViolations([...res.violations]);
              })
            }
            className="text-xs rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 ml-2"
          >
            对照清单校验片段
          </button>
          {validatePassed !== null && (
            <p className="text-[10px] text-gray-700 dark:text-gray-300 mt-2">
              {validatePassed ? "通过" : "未通过"}
              {validateViolations.length > 0 && (
                <ul className="mt-1 list-disc pl-4">
                  {validateViolations.map((v) => (
                    <li key={v}>{v}</li>
                  ))}
                </ul>
              )}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
