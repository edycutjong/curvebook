import Link from "next/link";

// In a racing form, a "scratched" runner was withdrawn before the race: listed, but not running.
export default function NotFound() {
  return (
    <>
      <div className="pagehead">
        <p className="small muted mono" style={{ margin: 0 }}>404 · not on the card</p>
        <h1>Scratched</h1>
        <p className="dek">Nothing runs at this address.</p>
      </div>
      <p className="empty">
        If you followed a pool or config address, it appears here once the indexer sees it on Solana mainnet. Nothing from before
        capture start (4 October 2026) is backfilled.
      </p>
      <p>
        <Link href="/" className="btn primary">Back to the Form</Link>
      </p>
      <ul className="links">
        <li><a href="/landing">Landing page</a></li>
        <li><a href="/pitch">Pitch deck</a></li>
        <li><Link href="/judge">Judges start here</Link></li>
        <li><Link href="/about">How it is measured</Link></li>
      </ul>
    </>
  );
}
