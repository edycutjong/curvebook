import type { Metadata } from "next";
import { getEvents, getHealth, getLaunches, getPresets } from "@/lib/queries";
import { age, bps, int, short, solscanAccount, solscanTx } from "@/lib/format";
import { ROUTER_PROGRAM_ID } from "@/lib/constants";
import { EventTicker } from "./EventTicker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify" };

export default async function VerifyPage() {
  const [events, { health, pools, windows }, presets, launches] = await Promise.all([getEvents(50), getHealth(), getPresets(), getLaunches(50)]);
  const routerNetwork = process.env.NEXT_PUBLIC_ROUTER_NETWORK ?? "localnet";
  const routerOnMainnet = routerNetwork === "mainnet-beta";
  const routerLink = routerNetwork === "localnet" ? null : solscanAccount(ROUTER_PROGRAM_ID) + (routerOnMainnet ? "" : `?cluster=${routerNetwork}`);

  return (
    <>
      <div className="pagehead">
        <h1>Verify</h1>
        <p className="dek">Every figure on the Form traces back to a mainnet signature. Here is the raw feed and the state of the stream.</p>
      </div>

      <section aria-labelledby="health-h">
        <div className="section-head">
          <h2 id="health-h">Stream health</h2>
          <p>{health ? `updated ${age(health.updated_at)}` : "no health row yet"}</p>
        </div>
        {health ? (
          <dl className="stats">
            <div><dt>Source</dt><dd>{health.source}</dd></div>
            <div><dt>Last slot</dt><dd>{int(health.last_slot)}</dd></div>
            <div><dt>Lag</dt><dd>{health.lag_slots == null ? "—" : `${health.lag_slots} slots`}</dd></div>
            <div><dt>Reconnects</dt><dd>{int(health.reconnects)}</dd></div>
            <div><dt>Last replay from</dt><dd>{health.last_from_slot == null ? "none" : int(health.last_from_slot)}</dd></div>
            <div><dt>Capture start</dt><dd>{int(health.capture_start_slot)}</dd></div>
            <div><dt>Pools seen</dt><dd>{int(health.pools_seen)}</dd></div>
            <div><dt>Windows final</dt><dd>{int(health.windows_final)}</dd></div>
            <div><dt>Incomplete</dt><dd>{int(health.windows_incomplete)}</dd></div>
          </dl>
        ) : (
          <p className="empty">The worker has not written a health row.</p>
        )}
        <p className="note">In the database now: {int(pools)} pools, {int(windows)} finished windows.</p>
      </section>

      <section aria-labelledby="events-h">
        <div className="section-head">
          <h2 id="events-h">Decoded DBC events</h2>
          <p>Last 50, refreshed every 3 s</p>
        </div>
        <EventTicker initial={events} />
      </section>

      <section aria-labelledby="router-h">
        <div className="section-head">
          <h2 id="router-h">Router program</h2>
          <p>{routerOnMainnet ? "deployed on mainnet-beta" : routerNetwork === "devnet" ? "deployed on devnet (claim + split path on the explorer); mainnet pending" : "localnet-tested; mainnet deploy pending"}</p>
        </div>
        <p className="mono" style={{ marginTop: 12, overflowWrap: "anywhere" }}>
          {routerLink ? <a href={routerLink} target="_blank" rel="noreferrer">{ROUTER_PROGRAM_ID}</a> : ROUTER_PROGRAM_ID}
        </p>
      </section>

      <section aria-labelledby="presets-h">
        <div className="section-head">
          <h2 id="presets-h">Presets</h2>
          <p>{presets.length} registered</p>
        </div>
        {presets.length === 0 ? (
          <p className="empty">No preset is registered yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="ruled">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Config</th>
                  <th scope="col">Vault</th>
                  <th scope="col" className="num">Author</th>
                  <th scope="col">Register tx</th>
                  <th scope="col" className="hide-md">Network</th>
                </tr>
              </thead>
              <tbody>
                {presets.map((p) => (
                  <tr key={p.config}>
                    <td className="txt"><a href={`/config/${p.config}`}>{p.name}</a></td>
                    <td>{short(p.config)}</td>
                    <td>{short(p.vault)}</td>
                    <td className="num">{bps(p.author_bps)}</td>
                    <td>{p.register_sig ? <a href={solscanTx(p.register_sig)} target="_blank" rel="noreferrer">{short(p.register_sig)}</a> : "—"}</td>
                    <td className="txt hide-md">{p.network}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="launches-h">
        <div className="section-head">
          <h2 id="launches-h">Launches through Curvebook</h2>
          <p>{launches.length} recorded</p>
        </div>
        {launches.length === 0 ? (
          <p className="empty">No launch has been sent through Curvebook yet.</p>
        ) : (
          <div className="scroll-x">
            <table className="ruled">
              <thead>
                <tr>
                  <th scope="col">Pool</th>
                  <th scope="col">Preset</th>
                  <th scope="col">Wallet</th>
                  <th scope="col" className="num">Landed slot</th>
                  <th scope="col">Via</th>
                  <th scope="col">Tx</th>
                </tr>
              </thead>
              <tbody>
                {launches.map((l) => (
                  <tr key={l.pool}>
                    <td><a href={`/pool/${l.pool}`}>{short(l.pool)}</a></td>
                    <td className="txt">{l.preset_name ?? short(l.preset)}</td>
                    <td>{short(l.wallet)}{l.third_party ? "" : " (team)"}</td>
                    <td className="num">{int(l.landed_slot)}</td>
                    <td className="txt">{l.via}</td>
                    <td><a href={solscanTx(l.sig)} target="_blank" rel="noreferrer">{short(l.sig)}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
