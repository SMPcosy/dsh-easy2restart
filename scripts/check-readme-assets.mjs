#!/usr/bin/env node
/**
 * Release gate for README images.
 *
 * Why this exists: npm and the DSH market NEVER resolve a README image path
 * against the published tarball. npm renders the README markdown as-is, so a
 * relative `![](error-dialog.png)` becomes a broken <img>; the market resolves
 * it to `https://raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>`, which
 * 404s whenever the repo is not publicly reachable. 0.1.4 shipped exactly that
 * bug and its screenshot was invisible on the npm page.
 *
 * Rules
 *   error  relative / non-https src            -> broken everywhere
 *   error  empty src                           -> broken everywhere
 *   warn   host outside the market allowlist    -> npm page OK, market preview dropped
 *   warn   .svg                                -> the market refuses svg
 *
 * Usage
 *   node scripts/check-readme-assets.mjs                 # static check, exit 1 on errors
 *   node scripts/check-readme-assets.mjs --remote        # + GET every src (warn on failure)
 *   node scripts/check-readme-assets.mjs --remote --strict  # + failures become errors
 *
 * Run it before every `npm publish` / `pnpm publish`; see RELEASING.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Hosts the DSH market will load a screenshot from (dshmarket market-data.ts). */
const MARKET_HOSTS = new Set([
  "raw.githubusercontent.com",
  "user-images.githubusercontent.com",
  "camo.githubusercontent.com",
  "github.com",
]);

const IMAGE_PATTERN =
  /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)|<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu;

const args = new Set(process.argv.slice(2));
const remote = args.has("--remote");
const strict = args.has("--strict");
const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const readmePath = resolve(fileArg ?? "README.md");

const source = readFileSync(readmePath, "utf8");
const lines = source.split(/\r?\n/u);
const lineOf = (index) => source.slice(0, index).split("\n").length;

const errors = [];
const warnings = [];
const images = [];

for (const match of source.matchAll(IMAGE_PATTERN)) {
  const raw = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  const alt = (match[1] ?? "").trim();
  const line = lineOf(match.index ?? 0);
  const label = `line ${line}${alt === "" ? "" : ` "${alt}"`}`;
  images.push({ raw, alt, line });

  if (raw === "") {
    errors.push(`${label}: empty image src`);
    continue;
  }
  if (/^data:/iu.test(raw)) {
    warnings.push(`${label}: inline data: URI (works, but bloats the README)`);
    continue;
  }
  if (!/^https?:\/\//iu.test(raw)) {
    errors.push(
      `${label}: relative path "${raw}" — npm and the market resolve it to a 404. ` +
        `Use an absolute https URL (e.g. https://cdn.jsdelivr.net/npm/<pkg>/<file>).`,
    );
    continue;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    errors.push(`${label}: unparseable URL "${raw}"`);
    continue;
  }
  if (url.protocol !== "https:") {
    errors.push(`${label}: ${url.protocol} is not https`);
    continue;
  }
  if (url.pathname.toLowerCase().endsWith(".svg")) {
    warnings.push(`${label}: svg — the DSH market refuses svg screenshots`);
  }
  if (!MARKET_HOSTS.has(url.hostname)) {
    warnings.push(
      `${label}: ${url.hostname} is not on the market image allowlist ` +
        `(${[...MARKET_HOSTS].join(", ")}); the npm page shows it, the market preview will not`,
    );
  }
}

async function probe({ raw, alt, line }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(raw, { redirect: "follow", signal: controller.signal });
    const type = res.headers.get("content-type") ?? "";
    const len = res.headers.get("content-length") ?? "?";
    const note = `line ${line}${alt === "" ? "" : ` "${alt}"`}: GET ${res.status} ${type} ${len}B`;
    if (!res.ok) (strict ? errors : warnings).push(`${note} — ${raw}`);
    else if (!type.toLowerCase().startsWith("image/")) (strict ? errors : warnings).push(`${note} — expected an image/* content type`);
    else console.log(`ok    ${note}`);
  } catch (error) {
    const note = `line ${line}${alt === "" ? "" : ` "${alt}"`}: GET failed (${error.message})`;
    (strict ? errors : warnings).push(`${note} — ${raw}`);
  } finally {
    clearTimeout(timer);
  }
}

console.log(`${readmePath}: ${images.length} image(s), ${lines.length} line(s)`);
for (const image of images) console.log(`      line ${image.line}: ${image.raw}`);
if (remote) {
  for (const image of images) {
    if (/^https?:\/\//iu.test(image.raw)) await probe(image);
  }
}

for (const warning of warnings) console.warn(`warn  ${warning}`);
for (const error of errors) console.error(`error ${error}`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) — fix them before publishing.`);
  process.exit(1);
}
console.log(`\nok — ${images.length} image(s) are publishable${warnings.length > 0 ? ` (${warnings.length} warning(s))` : ""}.`);
