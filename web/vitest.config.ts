import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    // Unit scope is the pure lib/ layer; pages, routes and DB access are covered by e2e/.
    coverage: { provider: "v8", include: ["lib/**/*.ts"], exclude: ["lib/db.ts", "lib/queries.ts"], reporter: ["text", "html"] },
  },
});
