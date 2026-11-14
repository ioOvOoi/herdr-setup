// A mod draws its own picture, and the shared picture is written only when it moved.
//
// Herdr re-renders a mod's root view whenever its live data changes (spaces,
// agents, terminals, focus, theme, shared state). A nested view made with
// `cx.new` is a *retained* child: the root's render hands back the same entity
// and the host stops there, so the child kept the last picture it drew until one
// of its own timers happened to notify it. The sidebar and the find sheet were
// mounted that way, and the panel could sit up to a minute behind — a sort
// chosen in the popup, an agent's status, a space selected from the keyboard.
// The root now builds its view itself and returns the view's own elements, so a
// root render is a panel render. This is the guard for both failures.
//
//   node tests/live.test.mjs
//   LIVE_ROOT=/some/other/checkout node tests/live.test.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.LIVE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const mods = join(root, "mods");

let failures = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !extra ? "" : ` — ${extra}`}`);
};

const sources = [];
for (const name of readdirSync(mods)) {
  const dir = join(mods, name);
  if (!statSync(dir).isDirectory()) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".js") || !statSync(join(dir, file)).isFile()) continue;
    sources.push({ mod: name, file, src: readFileSync(join(dir, file), "utf8") });
  }
}

// ---- no mod returns a retained child from render ---------------------------
// A retained child is fine inside a wrapper the renderer rebuilds
// (`div().child(entity)`); it is the *returned* entity that freezes live data,
// because the host has no reason to rebuild it on the next live change.
const offenders = [];
for (const { mod, file, src } of sources) {
  const entities = [...src.matchAll(/this\.(\w+)\s*=\s*cx\.new\s*\(/g)].map((m) => m[1]);
  if (!entities.length) continue;
  const at = src.search(/^ {2}(?:async\s+)?render\s*\(/m);
  if (at < 0) continue;
  const body = src.slice(at, src.indexOf("\n  }", at) + 3);
  for (const name of entities) {
    if (new RegExp(`return\\s+this\\.${name}\\s*;`).test(body)) offenders.push(`${mod}/${file}: render returns this.${name}`);
  }
}
check("no render hands back a retained child (a live change would not reach it)",
  !offenders.length, offenders.join(", "));

// ---- the sidebar/sheet root draws its view inline --------------------------
const main = readFileSync(join(mods, "agents-list/main.js"), "utf8");
check("the root builds its view itself",
  /this\.inner = new Which\(\);/.test(main) && /this\.inner\.init\(p, cx\);/.test(main),
  main.slice(main.indexOf("  init("), main.indexOf("  render(")));
check("the root returns the view's own elements", /return this\.inner\.render\(cx\);/.test(main));
check("the root forwards teardown to the view", /this\.inner\.close\?\.\(cx\);/.test(main));

// ---- the shared picture is written only when it changed --------------------
// `at` is when the picture was written, not part of it. With it in the change
// test every scan looked like a change: an idle window rewrote shared state,
// and so repainted every mod, once per scan.
const engine = readFileSync(join(mods, "agents-list/workspace-engine.js"), "utf8");
const start = engine.indexOf("export function persistWorkspace(");
if (start < 0) throw new Error("mods/agents-list/workspace-engine.js: no persistWorkspace");
const persist = engine.slice(start, engine.indexOf("\n}", start) + 2);
const compared = persist.slice(persist.indexOf("const state = {"), persist.indexOf("const json = JSON.stringify(state);"));
check("the change test leaves the write time out", !/\bat\s*:/.test(compared), compared.trim().split("\n")[0]);
check("the write still records when it ran", /setShared\(STATE_KEY, \{ \.\.\.state, at: now \}\);/.test(persist));
check("a forced write is still not repeated when nothing changed",
  /if \(json === workspace\.saved && !stale\) return false;/.test(persist));

if (failures) {
  console.error(`\n${failures} live check(s) failed`);
  process.exit(1);
}
console.log("all live checks passed");
