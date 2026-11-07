"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "./snapshot.ts";

const POLL_MS = 1000;

type Live = {
  /** Null until the first response arrives. After that it holds the last good values, even when connected is false. */
  snapshot: Snapshot | null;
  connected: boolean;
  /** Fetch now rather than at the next poll, for example right after a panel writes something. */
  refresh: () => Promise<void>;
};

const LiveContext = createContext<Live | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const lastText = useRef<string | null>(null);
  const sent = useRef(0);
  const applied = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sent.current;
    try {
      const response = await fetch("/api/live", { cache: "no-store" });
      if (!response.ok) throw new Error(`/api/live returned ${response.status}`);
      const text = await response.text();
      // A slow older response must not put back values a newer one replaced.
      if (request < applied.current) return;
      applied.current = request;
      setConnected(true);
      // Unchanged data keeps the same object, so an idle screen does not re-render.
      if (text !== lastText.current) {
        lastText.current = text;
        setSnapshot(JSON.parse(text) as Snapshot);
      }
    } catch (error) {
      if (request < applied.current) return;
      applied.current = request;
      console.error("Live update failed:", error);
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const value = useMemo(() => ({ snapshot, connected, refresh }), [snapshot, connected, refresh]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive() {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive must be used inside LiveProvider");
  return live;
}
