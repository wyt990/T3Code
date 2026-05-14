"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { DependencyGraph } from "@t3tools/contracts";

import { type DependencyImpactHighlight, impactTierForPath } from "./dependencyImpactHighlight";
import { layoutGlobalModuleDependencyGraph } from "../visualization/globalModuleDependencyLayout";

function applyImpactToNodes(nodes: Node[], highlight: DependencyImpactHighlight | null): Node[] {
  if (highlight === null) {
    return nodes;
  }
  return nodes.map((node) => {
    const tier = impactTierForPath(node.id, highlight);
    const prev = (node.style ?? {}) as CSSProperties;
    if (tier === "none") {
      return { ...node, style: { ...prev } };
    }
    const borderColor =
      tier === "changed"
        ? "rgb(59 130 246)"
        : tier === "direct"
          ? "rgb(245 158 11)"
          : "rgb(139 92 246)";
    const backgroundColor =
      tier === "changed"
        ? "rgba(59, 130, 246, 0.12)"
        : tier === "direct"
          ? "rgba(245, 158, 11, 0.1)"
          : "rgba(139, 92, 246, 0.08)";
    return {
      ...node,
      style: {
        ...prev,
        borderWidth: 2,
        borderStyle: "solid",
        borderColor,
        backgroundColor,
      },
    };
  });
}

function buildSubgraph(
  graph: DependencyGraph,
  focusPath: string | null | undefined,
  maxNodes: number,
): { nodes: Node[]; edges: Edge[] } {
  const cap = Math.max(8, Math.min(maxNodes, 80));
  const pathSet = new Set<string>();

  const focus = focusPath?.trim().replace(/\\/g, "/") ?? "";
  if (focus.length > 0) {
    pathSet.add(focus);
    const node = graph.nodes.find((n) => n.path === focus);
    if (node) {
      for (const imp of node.imports.slice(0, 24)) {
        pathSet.add(imp);
      }
    }
    for (const e of graph.edges) {
      if (e.to === focus) {
        pathSet.add(e.from);
      }
    }
  }

  if (pathSet.size === 0) {
    for (const n of graph.nodes) {
      pathSet.add(n.path);
      if (pathSet.size >= cap) {
        break;
      }
    }
  }

  const paths = [...pathSet].slice(0, cap);
  const pathOk = new Set(paths);

  const edges: Edge[] = [];
  let ei = 0;
  for (const e of graph.edges) {
    if (!pathOk.has(e.from) || !pathOk.has(e.to)) {
      continue;
    }
    const baseEdge = {
      id: `e-${ei++}`,
      source: e.from,
      target: e.to,
      animated: e.type === "import",
    };
    edges.push(
      e.type === "call"
        ? { ...baseEdge, style: { stroke: "#a855f7", strokeDasharray: "5 3" } }
        : e.type === "external"
          ? { ...baseEdge, style: { stroke: "#64748b", strokeDasharray: "2 4" } }
          : baseEdge,
    );
  }

  const nodeWidth = 168;
  const nodeHeight = 40;
  const cols = Math.max(2, Math.ceil(Math.sqrt(paths.length)));
  const nodes: Node[] = paths.map((id, i) => {
    const short = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
    return {
      id,
      position: {
        x: (i % cols) * (nodeWidth + 32),
        y: Math.floor(i / cols) * (nodeHeight + 28),
      },
      data: { label: short, full: id },
      style: { fontSize: 11, width: nodeWidth },
    };
  });

  return { nodes, edges };
}

function buildGlobalModuleGraph(
  graph: DependencyGraph,
  pathFilter: string,
  maxNodes: number,
): { nodes: Node[]; edges: Edge[] } {
  const { nodes: lay, links } = layoutGlobalModuleDependencyGraph(graph, pathFilter, maxNodes);
  const nodeWidth = 172;
  const edges: Edge[] = links.map((l, i) => {
    const base = {
      id: `e-${i}`,
      source: l.source,
      target: l.target,
      animated: l.importLike,
    };
    return l.edgeType === "call"
      ? { ...base, style: { stroke: "#a855f7", strokeDasharray: "5 3" } }
      : l.edgeType === "external"
        ? { ...base, style: { stroke: "#64748b", strokeDasharray: "2 4" } }
        : base;
  });
  const nodes: Node[] = lay.map((n) => ({
    id: n.id,
    position: { x: n.x, y: n.y },
    data: { label: n.label, full: n.id },
    style: { fontSize: 10, width: nodeWidth },
  }));
  return { nodes, edges };
}

export function DependencyGraphFlow(props: {
  readonly graph: DependencyGraph;
  /** `subgraph`：围绕 focusPath 的邻域（默认，用于智能上下文）。`global`：工作区模块分栏全景（用于可视化调试）。 */
  readonly variant?: "subgraph" | "global";
  readonly focusPath?: string | null;
  /** `variant === "global"` 时按路径子串筛选节点 */
  readonly pathFilter?: string;
  readonly maxNodes?: number;
  readonly className?: string;
  /** 与 `context.analyzeChangeImpact` 结果对齐，在节点上叠加描边/底色。 */
  readonly impactHighlight?: DependencyImpactHighlight | null;
}) {
  const variant = props.variant ?? "subgraph";
  const maxNodes = props.maxNodes ?? (variant === "global" ? 180 : 48);
  const { nodes: baseNodes, edges: seedEdges } = useMemo(() => {
    if (variant === "global") {
      return buildGlobalModuleGraph(props.graph, props.pathFilter ?? "", maxNodes);
    }
    return buildSubgraph(props.graph, props.focusPath, maxNodes);
  }, [variant, props.graph, props.focusPath, props.pathFilter, maxNodes]);

  const seedNodes = useMemo(
    () => applyImpactToNodes(baseNodes, props.impactHighlight ?? null),
    [baseNodes, props.impactHighlight],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(seedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(seedEdges);

  useEffect(() => {
    setNodes(seedNodes);
    setEdges(seedEdges);
  }, [seedNodes, seedEdges, setNodes, setEdges]);

  return (
    <div
      className={`${variant === "global" ? "h-[min(520px,62vh)]" : "h-[min(420px,55vh)]"} w-full rounded-md border border-border ${props.className ?? ""}`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={1.4}
        colorMode="system"
      >
        <MiniMap zoomable pannable className="!bg-muted" />
        <Controls showInteractive={false} />
        <Background gap={16} />
      </ReactFlow>
    </div>
  );
}
