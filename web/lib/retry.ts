// Retry a page's queries when Postgres is briefly out of connection slots. A burst of unique pages
// (crawlers, link checkers) can start more function instances than Postgres has slots for; waiting
// a moment beats a 500, because instances release their connections within seconds.

/** 53300 too_many_connections; 57P01/57P05 the server ended the session (admin / idle-session timeout). */
const TRANSIENT = new Set(["53300", "57P01", "57P05", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET"]);

export const isTransient = (e: unknown) => TRANSIENT.has(String((e as { code?: unknown } | null)?.code ?? ""));

export function retrying<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  { attempts = 4, baseMs = 250, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), random = Math.random } = {},
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    for (let i = 1; ; i++) {
      try {
        return await fn(...args);
      } catch (e) {
        if (i >= attempts || !isTransient(e)) throw e;
        await sleep(baseMs * 2 ** (i - 1) * (0.5 + random())); // jittered: 125-375, 250-750, 500-1500 ms
      }
    }
  };
}
