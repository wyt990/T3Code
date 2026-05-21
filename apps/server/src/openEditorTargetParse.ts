const TARGET_WITH_POSITION_PATTERN = /^(.*?):(\d+)(?::(\d+))?$/;

export function parseOpenEditorTarget(target: string): {
  path: string;
  line: string | undefined;
  column: string | undefined;
} {
  const normalized = target.trim().replace(/\\/g, "/");
  const match = TARGET_WITH_POSITION_PATTERN.exec(normalized);
  if (!match?.[1] || !match[2]) {
    return { path: normalized, line: undefined, column: undefined };
  }

  return {
    path: match[1],
    line: match[2],
    column: match[3],
  };
}

export const formatOpenEditorTarget = (input: {
  readonly path: string;
  readonly line?: string | undefined;
  readonly column?: string | undefined;
}): string => {
  if (input.line === undefined) {
    return input.path;
  }
  if (input.column === undefined) {
    return `${input.path}:${input.line}`;
  }
  return `${input.path}:${input.line}:${input.column}`;
};
