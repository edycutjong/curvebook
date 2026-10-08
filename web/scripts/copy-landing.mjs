// Copies the static landing page and pitch deck (source of truth: ../docs; served only by this Vercel app)
// into public/landing so the Vercel app serves them at /landing and /pitch. Relative paths are rewritten
// to absolute /landing/… because Next serves these without a trailing slash. Output is gitignored.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const docs = join(web, "..", "docs");
const out = join(web, "public", "landing");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "pitch"), { recursive: true });
for (const dir of ["img", "assets"]) cpSync(join(docs, dir), join(out, dir), { recursive: true });

const SITE = "https://curvebook.edycu.dev";
// Only real file references (img/, assets/, pitch/, optionally ../-prefixed) are rewritten; meta text is left alone.
const absolutize = (html, prefix) =>
  html.replace(/(\s(src|href|content|poster)=")((?:\.\.\/)*(?:img|assets|pitch)\/[^"]*)"/g, (_, attr, name, path) => {
    if (path === "pitch/") return `${attr}/pitch"`;
    const abs = new URL(path, `${SITE}${prefix}`).pathname;
    return `${attr}${name === "content" ? SITE + abs : abs}"`; // og:image needs a full URL
  });

writeFileSync(join(out, "index.html"), absolutize(readFileSync(join(docs, "index.html"), "utf8"), "/landing/"));
writeFileSync(join(out, "pitch", "index.html"), absolutize(readFileSync(join(docs, "pitch", "index.html"), "utf8"), "/landing/pitch/"));
console.log("landing + pitch copied to public/landing");
