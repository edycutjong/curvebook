/** Postgres bigint/numeric columns arrive as BigInt; JSON.stringify throws on them. */
export const toJson = (body: unknown) => JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v));
