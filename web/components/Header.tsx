import Link from "next/link";
import { getHealth } from "@/lib/queries";
import { LiveDot } from "./LiveDot";

export async function Header() {
  const { health } = await getHealth().catch(() => ({ health: null }));
  return (
    <header className="masthead">
      <div className="wrap masthead-row">
        <Link href="/" className="wordmark" aria-label="Curvebook, home">
          {/* 32px static SVG mark: next/image would skip optimization for SVG anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>CURVEBOOK</span>
        </Link>
        <nav aria-label="Main">
          <Link href="/">The Form</Link>
          <Link href="/integrations/verify">Verify</Link>
          <Link href="/about">Method</Link>
          <Link href="/judge">Judges</Link>
        </nav>
        <LiveDot initial={{ slot: health?.last_slot ?? null, lag: health?.lag_slots ?? null, updatedAt: health?.updated_at ?? null }} />
      </div>
    </header>
  );
}
