"use client";

import { useEffect, useState } from "react";

// /how-it-works: the six agents as a graph that lights up the step being read. Each step's section carries
// data-step="<index>"; whichever one crosses the middle of the screen is the active node. The server renders no active node,
// every node in its finished state, so the graph reads complete before any script runs.

export type GraphNode = { name: string; role: string; at: string; human?: boolean; parallel?: boolean };

export function AgentGraph({ nodes }: { nodes: GraphNode[] }) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const step of document.querySelectorAll("[data-step]")) observer.observe(step);
    return () => observer.disconnect();
  }, []);

  return (
    <ol aria-label="The agents, in order" className="grid gap-2">
      {nodes.map((node, i) => {
        const on = i === active;
        // Negotiator and Filer run side by side after the approval: the second of the pair is indented under a bracket.
        return (
          <li key={node.name} className={node.parallel ? "border-l-2 border-line pl-3" : ""}>
            <a
              href={`#step-${i + 1}`}
              aria-current={on ? "step" : undefined}
              className={`step-light grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-[10px] border px-4 py-3 ${
                on ? "border-agent bg-sheet" : "border-line"
              }`}
            >
              <span
                aria-hidden="true"
                className={`step-light size-2.5 rounded-full ${on ? (node.human ? "live-pulse bg-warn" : "live-pulse bg-agent") : node.human ? "bg-warn" : "bg-faded"}`}
              />
              <span className="min-w-0">
                <span className={`block font-semibold ${node.human ? "text-warn" : ""}`}>{node.name}</span>
                <span className="block truncate text-[15px] text-faded">{node.role}</span>
              </span>
              <span className="text-[15px] text-faded tabular-nums">{node.at}</span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
