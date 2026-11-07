"use client";

import { useEffect, useRef } from "react";

// How far from the end still counts as following along.
const NEAR_END_PX = 40;

/** Keeps a panel at its newest row unless someone has scrolled up. Put the returned ref on any element inside the panel. */
export function useFollow(count: number) {
  const anchor = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  useEffect(() => {
    // Panel's scrolling body.
    const scroller = anchor.current?.closest('[role="group"]');
    if (!scroller) return;
    if (scroller.scrollTop + scroller.clientHeight >= lastHeight.current - NEAR_END_PX) scroller.scrollTop = scroller.scrollHeight;
    lastHeight.current = scroller.scrollHeight;
  }, [count]);
  return anchor;
}
