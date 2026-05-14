import { create } from "zustand";
import type {
  TestCase as TestCaseType,
  TestCaseCreateInput,
  TestSuite,
  CoverageReport as CoverageReportType,
  TestGenerationResult,
  RegressionTestSelection,
  ProjectId,
  TestRunConfig,
  TestRunResult,
} from "@t3tools/contracts";

import { readPrimaryWsRpcClient } from "../rpc/wsClientHelpers";

export function testCaseToCreateInput(tc: TestCaseType): TestCaseCreateInput {
  return {
    name: tc.name,
    ...(tc.description !== undefined ? { description: tc.description } : {}),
    type: tc.type,
    ...(tc.targetFunction !== undefined ? { targetFunction: tc.targetFunction } : {}),
    ...(tc.targetFile !== undefined ? { targetFile: tc.targetFile } : {}),
    code: tc.code,
    status: tc.status,
    ...(tc.coverage !== undefined ? { coverage: tc.coverage } : {}),
  };
}

interface TestState {
  // Test Suites
  suites: TestSuite[];
  selectedSuiteId: string | null;

  // Test Generation
  generationResults: TestGenerationResult[];
  isGenerating: boolean;

  // Coverage
  coverageReports: CoverageReportType[];
  selectedReportId: string | null;

  // Regression Selection
  regressionSelection: RegressionTestSelection | null;
  isSelectingRegression: boolean;
  lastTestRun: TestRunResult | null;
  isRunningWorkspaceTests: boolean;

  // Actions
  setSuites: (suites: TestSuite[]) => void;
  selectSuite: (suiteId: string | null) => void;
  addGenerationResult: (result: TestGenerationResult) => void;
  setCoverageReports: (reports: CoverageReportType[]) => void;
  selectReport: (reportId: string | null) => void;
  setRegressionSelection: (selection: RegressionTestSelection | null) => void;
  generateTests: (targetFile: string, targetType?: "unit" | "integration") => Promise<void>;
  runRegressionTests: (changedFiles: string[], workspaceRoot?: string) => Promise<void>;
  executeWorkspaceTests: (config: TestRunConfig) => Promise<void>;
  fetchCoverageReport: (
    projectId: ProjectId,
    workspaceRoot?: string,
    options?: {
      readonly linesCoverageMinPercent?: number;
      readonly weakAreaMaxLinesPercent?: number;
    },
  ) => Promise<void>;
  refreshSuitesFromServer: (projectId: ProjectId) => Promise<void>;
  createTestSuiteOnServer: (
    projectId: ProjectId,
    name: string,
    testCases: readonly TestCaseCreateInput[],
  ) => Promise<void>;
  deleteTestSuiteOnServer: (projectId: ProjectId, suiteId: string) => Promise<void>;
}

export const useTestStore = create<TestState>((set, get) => ({
  suites: [],
  selectedSuiteId: null,
  generationResults: [],
  isGenerating: false,
  coverageReports: [],
  selectedReportId: null,
  regressionSelection: null,
  isSelectingRegression: false,
  lastTestRun: null,
  isRunningWorkspaceTests: false,

  setSuites: (suites) => set({ suites }),
  selectSuite: (suiteId) => set({ selectedSuiteId: suiteId }),
  addGenerationResult: (result) =>
    set((state) => ({
      generationResults: [...state.generationResults, result],
    })),
  setCoverageReports: (reports) => set({ coverageReports: reports }),
  selectReport: (reportId) => set({ selectedReportId: reportId }),
  setRegressionSelection: (selection) => set({ regressionSelection: selection }),

  generateTests: async (targetFile, targetType = "unit") => {
    const client = readPrimaryWsRpcClient();
    set({ isGenerating: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const result = await client.testing.generateTests({
        targetFile,
        type: targetType,
        generateMocks: false,
        coverageTarget: 80,
      });
      set((state) => ({
        generationResults: [...state.generationResults, result],
        isGenerating: false,
      }));
    } catch (error) {
      set({ isGenerating: false });
      console.error("Failed to generate tests:", error);
    }
  },

  runRegressionTests: async (changedFiles, workspaceRoot) => {
    const client = readPrimaryWsRpcClient();
    set({ isSelectingRegression: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const selection = await client.testing.selectRegressionTests({
        changedFiles,
        ...(workspaceRoot !== undefined && workspaceRoot.trim().length > 0
          ? { workspaceRoot: workspaceRoot.trim() }
          : {}),
      });
      set({ regressionSelection: selection, isSelectingRegression: false });
    } catch (error) {
      set({ isSelectingRegression: false });
      console.error("Failed to select regression tests:", error);
    }
  },

  executeWorkspaceTests: async (config) => {
    const client = readPrimaryWsRpcClient();
    set({ isRunningWorkspaceTests: true });
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const result = await client.testing.runTests(config);
      set({ lastTestRun: result, isRunningWorkspaceTests: false });
    } catch (error) {
      set({ isRunningWorkspaceTests: false });
      console.error("Failed to run tests:", error);
    }
  },

  fetchCoverageReport: async (projectId, workspaceRoot, options) => {
    const client = readPrimaryWsRpcClient();
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const report = await client.testing.getCoverageReport({
        projectId,
        ...(workspaceRoot !== undefined && workspaceRoot.trim().length > 0
          ? { workspaceRoot: workspaceRoot.trim() }
          : {}),
        ...(options?.linesCoverageMinPercent !== undefined
          ? { linesCoverageMinPercent: options.linesCoverageMinPercent }
          : {}),
        ...(options?.weakAreaMaxLinesPercent !== undefined
          ? { weakAreaMaxLinesPercent: options.weakAreaMaxLinesPercent }
          : {}),
      });
      set((state) => {
        const rest = state.coverageReports.filter((r) => r.projectId !== report.projectId);
        return {
          coverageReports: [...rest, report],
          selectedReportId: report.projectId,
        };
      });
    } catch (error) {
      console.error("Failed to fetch coverage report:", error);
    }
  },

  refreshSuitesFromServer: async (projectId) => {
    const client = readPrimaryWsRpcClient();
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      const { suites } = await client.testing.listTestSuites({ projectId });
      set({ suites: [...suites] });
    } catch (error) {
      console.error("Failed to list test suites:", error);
    }
  },

  createTestSuiteOnServer: async (projectId, name, testCases) => {
    const client = readPrimaryWsRpcClient();
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      await client.testing.createTestSuite({
        projectId,
        name,
        testCases: [...testCases],
      });
      await get().refreshSuitesFromServer(projectId);
    } catch (error) {
      console.error("Failed to create test suite:", error);
    }
  },

  deleteTestSuiteOnServer: async (projectId, suiteId) => {
    const client = readPrimaryWsRpcClient();
    try {
      if (!client) {
        throw new Error("WebSocket 客户端未就绪");
      }
      await client.testing.deleteTestSuite({ projectId, suiteId });
      await get().refreshSuitesFromServer(projectId);
    } catch (error) {
      console.error("Failed to delete test suite:", error);
    }
  },
}));

// Export TestCase type for use in other files
export type TestCase = TestCaseType;
export type { TestCaseCreateInput } from "@t3tools/contracts";

// Re-export CoverageReport directly from contracts
export type { CoverageReport as CoverageReportType } from "@t3tools/contracts";

// Selectors
export const useTestSuites = () => useTestStore((s) => s.suites);
export const useSelectedSuite = () => {
  const selectedId = useTestStore((s) => s.selectedSuiteId);
  const suites = useTestStore((s) => s.suites);
  return selectedId ? suites.find((s) => s.id === selectedId) : null;
};
export const useTestGenerationResults = () => useTestStore((s) => s.generationResults);
export const useLatestCoverageReport = (): CoverageReportType | null => {
  const reports = useTestStore((s) => s.coverageReports);
  return reports.length > 0 ? reports[reports.length - 1]! : null;
};
export const useRegressionSelection = () => useTestStore((s) => s.regressionSelection);
export const useLastTestRun = () => useTestStore((s) => s.lastTestRun);
export const useIsRunningWorkspaceTests = () => useTestStore((s) => s.isRunningWorkspaceTests);
