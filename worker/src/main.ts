// Curvebook worker: index every DBC launch's first 10 slots, aggregate the Form, land launches.
// Entrypoint wiring only; all behavior lives in app.ts (startWorker), which is what's tested.
import { config } from "./env.js";
import { acquireIndexLock, connect, migrate } from "./db.js";
import { startWorker, realDeps } from "./app.js";

const sql = connect(config.databaseUrl);
await migrate(sql);
if (!(await acquireIndexLock(sql))) {
  console.error("another worker already indexes this database; refusing to start");
  process.exit(1);
}
await startWorker(realDeps(config, sql));
