const MAX_SNIPPET_CHARS = 120_000;

/** 提取用户消息中的 Markdown 围栏代码块（用于回合前质检）。 */
export function extractMarkdownCodeBlocks(
  text: string,
): readonly { readonly lang: string; readonly body: string }[] {
  const out: { lang: string; body: string }[] = [];
  const re = /```([a-z0-9+#.-]*)\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const lang = (match[1] ?? "").trim().toLowerCase();
    let body = (match[2] ?? "").trim();
    if (body.length === 0) {
      continue;
    }
    if (body.length > MAX_SNIPPET_CHARS) {
      body = body.slice(0, MAX_SNIPPET_CHARS);
    }
    out.push({ lang, body });
  }
  return out;
}
