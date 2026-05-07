/**
 * Supplement injected into Codex `developer_instructions` and Claude Agent SDK
 * `additionalInstructions` so checklist / todo titles match T3 sidebar locale.
 *
 * @module T3AgentSidebarLocaleInstructions
 */
export const T3_CODE_SIDEBAR_CHECKLIST_ZH_SUPPLEMENT = `
## T3 Code task/plan sidebar locale

When you use checklist or todo tools whose entries appear in the T3 Code **task/plan** sidebar (for example TodoWrite, \`update_plan\`, or equivalent capabilities in Claude Code / OpenCode), write each step title in **Simplified Chinese**. Keep file paths, shell commands, identifiers, and API names in their original form when that aids clarity.
`.trim();
