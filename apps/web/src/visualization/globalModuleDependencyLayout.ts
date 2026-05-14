import type { DependencyEdge, DependencyGraph } from "@t3tools/contracts";

export type GlobalLayoutNode = {
  readonly id: string;
  readonly label: string;
  /** 节点左上角 x（与 React Flow `position` 一致） */
  readonly x: number;
  /** 节点左上角 y */
  readonly y: number;
};

export type GlobalLayoutLink = {
  readonly source: string;
  readonly target: string;
  /** @deprecated 使用 `edgeType` 与 `import`/`call` 动画一致 */
  readonly importLike: boolean;
  readonly edgeType: DependencyEdge["type"];
};

const GLOBAL_EDGE_CAP = 620;

/** 与 `DependencyGraphFlow` 全局分栏布局一致，供 React Flow / D3 共用。 */
export function layoutGlobalModuleDependencyGraph(
  graph: DependencyGraph,
  pathFilter: string,
  maxNodes: number,
): { nodes: GlobalLayoutNode[]; links: GlobalLayoutLink[] } {
  const cap = Math.min(Math.max(maxNodes, 12), 220);
  const q = pathFilter.trim().toLowerCase();
  let paths = graph.nodes.map((n) => n.path.replace(/\\/g, "/"));
  if (q.length > 0) {
    paths = paths.filter((p) => p.toLowerCase().includes(q));
  }
  paths.sort((a, b) => a.localeCompare(b));
  paths = paths.slice(0, cap);
  const pathOk = new Set(paths);

  const rawEdges: DependencyEdge[] = [];
  for (const e of graph.edges) {
    if (rawEdges.length >= GLOBAL_EDGE_CAP) {
      break;
    }
    const from = e.from.replace(/\\/g, "/");
    const to = e.to.replace(/\\/g, "/");
    if (!pathOk.has(from) || !pathOk.has(to)) {
      continue;
    }
    rawEdges.push(e);
  }

  const links: GlobalLayoutLink[] = rawEdges.map((e) => ({
    source: e.from.replace(/\\/g, "/"),
    target: e.to.replace(/\\/g, "/"),
    importLike: e.type === "import" || e.type === "call",
    edgeType: e.type,
  }));

  const groups = new Map<string, string[]>();
  for (const p of paths) {
    const head = p.includes("/") ? (p.split("/")[0] ?? "_") : p;
    const list = groups.get(head) ?? [];
    list.push(p);
    groups.set(head, list);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b));

  const nodeWidth = 172;
  const nodeHeight = 36;
  const colGap = 40;
  const rowGap = 8;
  const nodes: GlobalLayoutNode[] = [];
  let colX = 0;
  for (const key of groupKeys) {
    const items = groups.get(key) ?? [];
    let y = 0;
    for (const id of items) {
      const short = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
      nodes.push({
        id,
        label: short,
        x: colX,
        y,
      });
      y += nodeHeight + rowGap;
    }
    colX += nodeWidth + colGap;
  }

  return { nodes, links };
}
