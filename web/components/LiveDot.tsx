"use client";
import { useEffect, useState } from "react";
import { int } from "@/lib/format";
import { isLive } from "@/lib/form";

type H = { slot: number | null; lag: number | null; updatedAt: string | null };

export function LiveDot({ initial }: { initial: H }) {
  const [h, setH] = useState(initial);
  const [now, setNow] = useState(() => Date.parse(initial.updatedAt ?? "") || 0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = await r.json();
        if (alive && j.health) setH({ slot: j.health.last_slot, lag: j.health.lag_slots, updatedAt: j.health.updated_at });
      } catch {
        /* keep the last reading; staleness shows through the dot */
      }
      if (alive) setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  const live = now > 0 && isLive(h.lag, h.updatedAt, now);
  return (
    <p className={`livedot ${live ? "on" : "off"}`} title={h.lag != null ? `stream lag ${h.lag} slots` : undefined}>
      <span className="dot" aria-hidden="true" />
      <span>{live ? "live" : "stale"}</span>
      <span className="mono">slot {int(h.slot)}</span>
    </p>
  );
}
