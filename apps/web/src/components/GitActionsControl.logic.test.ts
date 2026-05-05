import type { GitStatusResult } from "@t3tools/contracts";
import { assert, describe, it } from "vitest";
import {
  buildGitActionProgressStages,
  buildMenuItems,
  requiresDefaultBranchConfirmation,
  resolveAutoFeatureBranchName,
  resolveDefaultBranchActionDialogCopy,
  resolveLiveThreadBranchUpdate,
  resolveQuickAction,
  resolveThreadBranchUpdate,
} from "./GitActionsControl.logic";

function status(overrides: Partial<GitStatusResult> = {}): GitStatusResult {
  return {
    isRepo: true,
    hasOriginRemote: true,
    isDefaultBranch: false,
    branch: "feature/test",
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: null,
    ...overrides,
  };
}

describe("when: branch is clean and has an open PR", () => {
  it("resolveQuickAction opens the existing PR", () => {
    const quick = resolveQuickAction(
      status({
        pr: {
          number: 10,
          title: "Open PR",
          url: "https://example.com/pr/10",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "open_pr", label: "查看 PR", disabled: false });
  });

  it("buildMenuItems disables commit/push and enables open PR", () => {
    const items = buildMenuItems(
      status({
        pr: {
          number: 11,
          title: "Existing PR",
          url: "https://example.com/pr/11",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "查看 PR",
        disabled: false,
        icon: "pr",
        kind: "open_pr",
      },
    ]);
  });
});

describe("when: actions are busy", () => {
  it("resolveQuickAction returns running disabled state", () => {
    const quick = resolveQuickAction(status(), true);
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "提交",
      disabled: true,
      hint: "Git 操作正在进行中。",
    });
  });

  it("buildMenuItems disables all actions", () => {
    const items = buildMenuItems(status(), true);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: git status is unavailable", () => {
  it("resolveQuickAction returns unavailable disabled state", () => {
    const quick = resolveQuickAction(null, false);
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "提交",
      disabled: true,
      hint: "Git 状态不可用。",
    });
  });

  it("buildMenuItems returns no menu items", () => {
    const items = buildMenuItems(null, false);
    assert.deepEqual(items, []);
  });
});

describe("when: branch is clean, ahead, and has an open PR", () => {
  it("resolveQuickAction prefers push", () => {
    const quick = resolveQuickAction(
      status({
        aheadCount: 3,
        pr: {
          number: 13,
          title: "Open PR",
          url: "https://example.com/pr/13",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, { kind: "run_action", action: "push", label: "推送" });
  });

  it("buildMenuItems enables push and keeps open PR available", () => {
    const items = buildMenuItems(
      status({
        aheadCount: 2,
        pr: {
          number: 12,
          title: "Existing PR",
          url: "https://example.com/pr/12",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "查看 PR",
        disabled: false,
        icon: "pr",
        kind: "open_pr",
      },
    ]);
  });
});

describe("when: branch is clean, ahead, and has no open PR", () => {
  it("resolveQuickAction pushes and creates a PR", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, pr: null }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      label: "推送并创建 PR",
    });
  });

  it("buildMenuItems enables push and create PR, with commit disabled", () => {
    const items = buildMenuItems(status({ aheadCount: 2, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: false,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: branch is clean, up to date, and has no open PR", () => {
  it("resolveQuickAction returns disabled no-action state", () => {
    const quick = resolveQuickAction(
      status({ aheadCount: 0, behindCount: 0, hasWorkingTreeChanges: false, pr: null }),
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", label: "提交", disabled: true });
  });

  it("buildMenuItems disables commit, push, and create PR", () => {
    const items = buildMenuItems(status({ aheadCount: 0, behindCount: 0, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: branch is behind upstream", () => {
  it("resolveQuickAction returns pull", () => {
    const quick = resolveQuickAction(status({ behindCount: 2 }), false);
    assert.deepInclude(quick, { kind: "run_pull", label: "拉取", disabled: false });
  });

  it("buildMenuItems disables push and create PR", () => {
    const items = buildMenuItems(status({ behindCount: 1, pr: null }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: branch has diverged from upstream", () => {
  it("resolveQuickAction returns a disabled sync hint", () => {
    const quick = resolveQuickAction(status({ aheadCount: 2, behindCount: 1 }), false);
    assert.deepEqual(quick, {
      label: "同步分支",
      disabled: true,
      kind: "show_hint",
      hint: "分支已从上游分离。请先变基/合并。",
    });
  });
});

describe("when: working tree has local changes", () => {
  it("resolveQuickAction returns commit, push, and create PR", () => {
    const quick = resolveQuickAction(status({ hasWorkingTreeChanges: true }), false);
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push_pr",
      label: "提交、推送并创建 PR",
    });
  });

  it("resolveQuickAction falls back to commit when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, hasUpstream: false }),
      false,
      false,
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit",
      label: "提交",
      disabled: false,
    });
  });

  it("resolveQuickAction returns commit and push when open PR exists", () => {
    const quick = resolveQuickAction(
      status({
        hasWorkingTreeChanges: true,
        pr: {
          number: 16,
          title: "Existing PR",
          url: "https://example.com/pr/16",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "提交并推送",
    });
  });

  it("buildMenuItems enables commit and disables push and PR", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: false,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: on default branch without open PR", () => {
  it("resolveQuickAction returns commit and push when local changes exist", () => {
    const quick = resolveQuickAction(
      status({ branch: "main", hasWorkingTreeChanges: true }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "提交并推送",
      disabled: false,
    });
  });

  it("resolveQuickAction returns push when branch is ahead", () => {
    const quick = resolveQuickAction(
      status({ branch: "main", aheadCount: 2, pr: null }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "推送",
      disabled: false,
    });
  });
});

describe("when: working tree has local changes and branch is behind upstream", () => {
  it("resolveQuickAction still prefers commit, push, and create PR", () => {
    const quick = resolveQuickAction(
      status({ hasWorkingTreeChanges: true, behindCount: 1 }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push_pr",
      label: "提交、推送并创建 PR",
    });
  });

  it("buildMenuItems enables commit and keeps push and PR disabled", () => {
    const items = buildMenuItems(status({ hasWorkingTreeChanges: true, behindCount: 2 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: false,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: HEAD is detached and there are no local changes", () => {
  it("resolveQuickAction shows detached head hint", () => {
    const quick = resolveQuickAction(
      status({ branch: null, hasWorkingTreeChanges: false, hasUpstream: false }),
      false,
    );
    assert.deepInclude(quick, { kind: "show_hint", label: "提交", disabled: true });
  });

  it("buildMenuItems keeps commit, push, and PR disabled", () => {
    const items = buildMenuItems(status({ branch: null, hasWorkingTreeChanges: false }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("when: branch has no upstream configured", () => {
  it("resolveQuickAction is disabled when clean, no upstream, and no local commits are ahead", () => {
    const quick = resolveQuickAction(
      status({ hasUpstream: false, pr: null, aheadCount: 0 }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "推送",
      hint: "没有本地提交可推送。",
      disabled: true,
    });
  });

  it("resolveQuickAction opens PR when clean, no upstream, no local commits are ahead, and PR exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 0,
        pr: {
          number: 14,
          title: "Existing PR",
          url: "https://example.com/pr/14",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "open_pr",
      label: "查看 PR",
      disabled: false,
    });
  });

  it("resolveQuickAction runs push when clean, no upstream, and local commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 1,
        pr: {
          number: 15,
          title: "Existing PR",
          url: "https://example.com/pr/15",
          baseBranch: "main",
          headBranch: "feature/test",
          state: "open",
        },
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "push",
      label: "推送",
      disabled: false,
    });
  });

  it("buildMenuItems disables push and create PR when no commits are ahead", () => {
    const items = buildMenuItems(status({ hasUpstream: false, pr: null, aheadCount: 0 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("resolveQuickAction runs push and create PR when no upstream and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "create_pr",
      label: "推送并创建 PR",
      disabled: false,
    });
  });

  it("resolveQuickAction disables push-and-pr flows when no origin remote exists", () => {
    const quick = resolveQuickAction(
      status({
        hasUpstream: false,
        aheadCount: 2,
        pr: null,
      }),
      false,
      false,
      false,
    );
    assert.deepEqual(quick, {
      kind: "show_hint",
      label: "推送",
      hint: '推送或创建拉取请求前请先添加 "origin" 远程。',
      disabled: true,
    });
  });

  it("buildMenuItems enables create PR when no upstream and commits are ahead", () => {
    const items = buildMenuItems(status({ hasUpstream: false, pr: null, aheadCount: 2 }), false);
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: false,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: false,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("buildMenuItems disables push and create PR when no origin remote exists", () => {
    const items = buildMenuItems(
      status({ hasUpstream: false, pr: null, aheadCount: 2 }),
      false,
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });

  it("resolveQuickAction is disabled on default branch when no upstream exists and no commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        branch: "main",
        hasUpstream: false,
        aheadCount: 0,
        pr: null,
      }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "show_hint",
      label: "推送",
      hint: "没有本地提交可推送。",
      disabled: true,
    });
  });

  it("resolveQuickAction uses push-only on default branch when no upstream exists and commits are ahead", () => {
    const quick = resolveQuickAction(
      status({
        branch: "main",
        hasUpstream: false,
        aheadCount: 1,
        pr: null,
      }),
      false,
      true,
    );
    assert.deepInclude(quick, {
      kind: "run_action",
      action: "commit_push",
      label: "推送",
      disabled: false,
    });
  });

  it("buildMenuItems still disables push and create PR when branch is behind", () => {
    const items = buildMenuItems(
      status({
        hasUpstream: false,
        behindCount: 1,
        aheadCount: 0,
        pr: null,
      }),
      false,
    );
    assert.deepEqual(items, [
      {
        id: "commit",
        label: "提交",
        disabled: true,
        icon: "commit",
        kind: "open_dialog",
        dialogAction: "commit",
      },
      {
        id: "push",
        label: "推送",
        disabled: true,
        icon: "push",
        kind: "open_dialog",
        dialogAction: "push",
      },
      {
        id: "pr",
        label: "创建 PR",
        disabled: true,
        icon: "pr",
        kind: "open_dialog",
        dialogAction: "create_pr",
      },
    ]);
  });
});

describe("requiresDefaultBranchConfirmation", () => {
  it("requires confirmation for push actions on default branch", () => {
    assert.isFalse(requiresDefaultBranchConfirmation("commit", true));
    assert.isTrue(requiresDefaultBranchConfirmation("push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("create_pr", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push", true));
    assert.isTrue(requiresDefaultBranchConfirmation("commit_push_pr", true));
    assert.isFalse(requiresDefaultBranchConfirmation("commit_push", false));
    assert.isFalse(requiresDefaultBranchConfirmation("push", false));
  });
});

describe("resolveDefaultBranchActionDialogCopy", () => {
  it("uses push-only copy when pushing without a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push",
      branchName: "main",
      includesCommit: false,
    });

    assert.deepEqual(copy, {
      title: "推送到默认分支？",
      description:
        '此操作将推送本地提交到 "main"。您可以在当前分支继续操作，或创建一个功能分支后执行相同的操作。',
      continueLabel: "推送到主分支",
    });
  });

  it("uses push-and-pr copy when creating a PR without a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push_pr",
      branchName: "main",
      includesCommit: false,
    });

    assert.deepEqual(copy, {
      title: "从默认分支推送并创建拉取请求？",
      description:
        '此操作将推送本地提交并创建拉取请求到 "main"。您可以在当前分支继续操作，或创建一个功能分支后执行相同的操作。',
      continueLabel: "推送并创建 PR",
    });
  });

  it("keeps commit copy when the action includes a commit", () => {
    const copy = resolveDefaultBranchActionDialogCopy({
      action: "commit_push_pr",
      branchName: "main",
      includesCommit: true,
    });

    assert.deepEqual(copy, {
      title: "从默认分支提交、推送并创建拉取请求？",
      description:
        '此操作将提交、推送并创建拉取请求到 "main"。您可以在当前分支继续操作，或创建一个功能分支后执行相同的操作。',
      continueLabel: "提交、推送并创建 PR",
    });
  });
});

describe("buildGitActionProgressStages", () => {
  it("shows only push progress for explicit push actions", () => {
    const stages = buildGitActionProgressStages({
      action: "push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, ["正在推送到 origin/feature/test..."]);
  });

  it("shows push and PR progress for create-pr actions that still need a push", () => {
    const stages = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      pushTarget: "origin/feature/test",
      shouldPushBeforePr: true,
    });
    assert.deepEqual(stages, [
      "正在推送到 origin/feature/test...",
      "正在准备 PR...",
      "正在生成 PR 内容...",
      "正在创建 GitHub 拉取请求...",
    ]);
  });

  it("shows only PR progress when create-pr can skip the push", () => {
    const stages = buildGitActionProgressStages({
      action: "create_pr",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: false,
      shouldPushBeforePr: false,
    });
    assert.deepEqual(stages, [
      "正在准备 PR...",
      "正在生成 PR 内容...",
      "正在创建 GitHub 拉取请求...",
    ]);
  });

  it("includes commit stages for commit+push when working tree is dirty", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push",
      hasCustomCommitMessage: false,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, [
      "正在生成提交信息...",
      "正在提交...",
      "正在推送到 origin/feature/test...",
    ]);
  });

  it("includes granular PR stages for commit+push+PR actions", () => {
    const stages = buildGitActionProgressStages({
      action: "commit_push_pr",
      hasCustomCommitMessage: true,
      hasWorkingTreeChanges: true,
      pushTarget: "origin/feature/test",
    });
    assert.deepEqual(stages, [
      "正在提交...",
      "正在推送到 origin/feature/test...",
      "正在准备 PR...",
      "正在生成 PR 内容...",
      "正在创建 GitHub 拉取请求...",
    ]);
  });
});

describe("resolveThreadBranchUpdate", () => {
  it("returns a branch update when the action created a new branch", () => {
    const update = resolveThreadBranchUpdate({
      action: "commit_push_pr",
      branch: {
        status: "created",
        name: "feature/fix-toast-copy",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: add branch sync",
      },
      push: { status: "pushed", branch: "feature/fix-toast-copy" },
      pr: { status: "skipped_not_requested" },
      toast: {
        title: "Pushed 89abcde to origin/feature/fix-toast-copy",
        cta: { kind: "none" },
      },
    });

    assert.deepEqual(update, {
      branch: "feature/fix-toast-copy",
    });
  });

  it("returns null when the action stayed on the existing branch", () => {
    const update = resolveThreadBranchUpdate({
      action: "commit_push",
      branch: {
        status: "skipped_not_requested",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: add branch sync",
      },
      push: { status: "pushed", branch: "feature/fix-toast-copy" },
      pr: { status: "skipped_not_requested" },
      toast: {
        title: "Pushed 89abcde to origin/feature/fix-toast-copy",
        cta: { kind: "none" },
      },
    });

    assert.equal(update, null);
  });
});

describe("resolveLiveThreadBranchUpdate", () => {
  it("returns a branch update when live git status differs from stored thread metadata", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/old-branch",
      gitStatus: status({ branch: "effect-atom" }),
    });

    assert.deepEqual(update, {
      branch: "effect-atom",
    });
  });

  it("returns null when live git status is unavailable", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "feature/old-branch",
      gitStatus: null,
    });

    assert.equal(update, null);
  });

  it("returns null when the stored thread branch already matches git status", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "effect-atom",
      gitStatus: status({ branch: "effect-atom" }),
    });

    assert.equal(update, null);
  });

  it("returns null when git status is detached HEAD but the thread already has a branch", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "effect-atom",
      gitStatus: status({ branch: null }),
    });

    assert.equal(update, null);
  });

  it("does not regress a semantic thread branch back to a temporary worktree branch", () => {
    const update = resolveLiveThreadBranchUpdate({
      threadBranch: "t3code/github-query-rate-limit",
      gitStatus: status({ branch: "t3code/bda76797" }),
    });

    assert.equal(update, null);
  });
});

describe("resolveAutoFeatureBranchName", () => {
  it("uses semantic preferred branch names when available", () => {
    const branch = resolveAutoFeatureBranchName(["main", "feature/other"], "fix toast copy");
    assert.equal(branch, "feature/fix-toast-copy");
  });

  it("normalizes preferred names that already include a branch namespace", () => {
    const branch = resolveAutoFeatureBranchName(["main"], "feature/refine-toolbar-actions");
    assert.equal(branch, "feature/refine-toolbar-actions");
  });

  it("increments suffix when the preferred branch name already exists", () => {
    const branch = resolveAutoFeatureBranchName(
      ["main", "feature/fix-toast-copy", "feature/fix-toast-copy-2"],
      "fix toast copy",
    );
    assert.equal(branch, "feature/fix-toast-copy-3");
  });

  it("treats existing branch names as case-insensitive for collision checks", () => {
    const branch = resolveAutoFeatureBranchName(["Feature/Ticket-1"], "feature/ticket-1");
    assert.equal(branch, "feature/ticket-1-2");
  });

  it("falls back to feature/update when no preferred name is provided", () => {
    const branch = resolveAutoFeatureBranchName(["main"]);
    assert.equal(branch, "feature/update");
  });
});
