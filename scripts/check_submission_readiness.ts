// Fails when judge-facing copy still carries placeholders or claims without receipts.
import { existsSync, readFileSync } from "node:fs";

const FILES = ["README.md", "DEMO.md", "ARCHITECTURE.md", "docs/AUDIT-SCOPE.md", "docs/DX-REPORT.md"];
const BANNED: [RegExp, string][] = [
  [/⟨measured|\bTBD\b|\bTODO\b|lorem ipsum/i, "placeholder"],
  [/youtu\.be\/x+|youtube\.com\/watch\?v=x+/i, "placeholder video link"],
  [/\b0x\.\.\.|\(\s*\)\]|\]\(\s*\)/, "empty link"],
  [/<your[-_ ]|REPLACE_ME|example\.invalid/i, "template value"],
];
let failures = 0;
for (const f of FILES) {
  if (!existsSync(f)) {
    console.log(`✗ ${f} missing`);
    failures++;
    continue;
  }
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const [re, why] of BANNED) if (re.test(line)) {
      console.log(`✗ ${f}:${i + 1} ${why}: ${line.trim().slice(0, 100)}`);
      failures++;
    }
  });
}
if (existsSync("DEMO.md")) {
  const demo = readFileSync("DEMO.md", "utf8");
  if (!/solscan\.io\/(tx|account)\//.test(demo)) {
    console.log("✗ DEMO.md has no explorer link");
    failures++;
  }
}
for (const f of [".claude", "CLAUDE.md", "AGENTS.md"]) if (existsSync(f)) {
  console.log(`✗ ${f} must not be in the public repo`);
  failures++;
}
console.log(failures ? `\n${failures} problem(s)` : "ready: no placeholders, explorer links present");
process.exit(failures ? 1 : 0);
