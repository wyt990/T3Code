"use client";

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3";

import type { DependencyGraph } from "@t3tools/contracts";

import {
  type DependencyImpactHighlight,
  impactTierForPath,
} from "../contextAwareness/dependencyImpactHighlight";
import { layoutGlobalModuleDependencyGraph } from "./globalModuleDependencyLayout";

const NODE_W = 172;
const NODE_H = 36;

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
}

function linkEndpoint(end: SimNode | string | number, axis: "x" | "y"): number {
  if (typeof end === "object" && end !== null && axis in end) {
    const v = (end as SimNode)[axis];
    return typeof v === "number" && !Number.isNaN(v) ? v : 0;
  }
  return 0;
}

function rectStroke(id: string, highlight: DependencyImpactHighlight | null): string {
  const tier = impactTierForPath(id, highlight);
  switch (tier) {
    case "changed":
      return "rgb(59 130 246)";
    case "direct":
      return "rgb(245 158 11)";
    case "transitive":
      return "rgb(139 92 246)";
    default:
      return "rgba(71, 85, 105, 0.45)";
  }
}

function rectFill(id: string, highlight: DependencyImpactHighlight | null): string {
  const tier = impactTierForPath(id, highlight);
  switch (tier) {
    case "changed":
      return "rgba(59, 130, 246, 0.14)";
    case "direct":
      return "rgba(245, 158, 11, 0.12)";
    case "transitive":
      return "rgba(139, 92, 246, 0.1)";
    default:
      return "rgba(148, 163, 184, 0.18)";
  }
}

export function ModuleDependencyGraphD3(props: {
  readonly graph: DependencyGraph;
  readonly pathFilter: string;
  readonly maxNodes: number;
  readonly impactHighlight: DependencyImpactHighlight | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const svgEl = svgRef.current;
    if (!wrap || !svgEl) {
      return;
    }

    const width = Math.max(wrap.clientWidth, 320);
    const height = Math.max(wrap.clientHeight, 400);

    const { nodes: layoutNodes, links: layoutLinks } = layoutGlobalModuleDependencyGraph(
      props.graph,
      props.pathFilter,
      props.maxNodes,
    );

    const highlight = props.impactHighlight;

    const nodes: SimNode[] = layoutNodes.map((n) => ({
      id: n.id,
      label: n.label,
      x: n.x + NODE_W / 2,
      y: n.y + NODE_H / 2,
    }));

    const linkData: SimulationLinkDatum<SimNode>[] = layoutLinks.map((l) => ({
      source: l.source,
      target: l.target,
    }));

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", "100%").attr("height", "100%");

    const root = svg.append("g");

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.12, 2.8])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        root.attr("transform", event.transform.toString());
      });
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity.translate(20, 20).scale(0.82));

    const simulation = d3
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, SimulationLinkDatum<SimNode>>(linkData)
          .id((d) => d.id)
          .distance(58)
          .strength(0.32),
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius(44));

    const linkSel = root
      .append("g")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.28)
      .selectAll("line")
      .data(linkData)
      .join("line");

    const nodeG = root.append("g").selectAll("g").data(nodes).join("g");

    const dragBehavior = d3
      .drag<SVGGElement, SimNode>()
      .on("start", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode | unknown>, d) => {
        if (!event.active) {
          simulation.alphaTarget(0.35).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode | unknown>, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event: d3.D3DragEvent<SVGGElement, SimNode, SimNode | unknown>, d) => {
        if (!event.active) {
          simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });

    nodeG.each(function (this: d3.BaseType, d: SimNode) {
      d3.select<SVGGElement, SimNode>(this as SVGGElement).call(dragBehavior);
    });

    nodeG
      .append("rect")
      .attr("x", -NODE_W / 2)
      .attr("y", -NODE_H / 2)
      .attr("width", NODE_W)
      .attr("height", NODE_H)
      .attr("rx", 6)
      .attr("fill", (d: SimNode) => rectFill(d.id, highlight))
      .attr("stroke", (d: SimNode) => rectStroke(d.id, highlight))
      .attr("stroke-width", (d: SimNode) =>
        impactTierForPath(d.id, highlight) === "none" ? 1 : 2,
      );

    nodeG
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 10)
      .attr("fill", "currentColor")
      .text((d: SimNode) => d.label);

    simulation.on("tick", () => {
      linkSel
        .attr("x1", (d) => linkEndpoint(d.source, "x"))
        .attr("y1", (d) => linkEndpoint(d.source, "y"))
        .attr("x2", (d) => linkEndpoint(d.target, "x"))
        .attr("y2", (d) => linkEndpoint(d.target, "y"));

      nodeG.attr("transform", (d: SimNode) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.on("tick", null);
      simulation.stop();
      svg.on(".zoom", null);
    };
  }, [props.graph, props.pathFilter, props.maxNodes, props.impactHighlight]);

  return (
    <div
      ref={wrapRef}
      className="h-[min(520px,62vh)] w-full rounded-md border border-border bg-muted/20 text-muted-foreground"
    >
      <svg ref={svgRef} className="block" role="img" aria-label="模块依赖力导向图" />
    </div>
  );
}
