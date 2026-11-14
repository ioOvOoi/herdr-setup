// Every `this.foo(` in a mod must name a method that mod defines, and no method
// may be defined twice in one file (the second body silently wins).
//
// A rename that misses one call site is invisible until someone presses that key:
// `this.dropPin()` kept its old name after the method became `dropPins()`, and the
// worktree dialog answered "this.dropPin is not a function" when it was used.
//
// A mod is one program, even when it is several files: the sidebar and the find
// sheet are one mod, and `this.pinRow` is defined in core.js for both of them.
// So a call is checked against every `.js` file the mod ships, while a duplicate
// is only a problem inside the file that defines it.
//
//   node tests/methods.test.mjs
//   MODS=/some/other/mods node tests/methods.test.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mods = process.env.MODS ?? join(dirname(fileURLToPath(import.meta.url)), "..", "mods");

const sources = (dir) => readdirSync(dir)
  .filter((f) => f.endsWith(".js") && statSync(join(dir, f)).isFile())
  .map((f) => ({ file: f, src: readFileSync(join(dir, f), "utf8") }));

const files = [];
for (const name of readdirSync(mods)) {
  const dir = join(mods, name);
  if (!statSync(dir).isDirectory()) continue;
  const list = sources(dir);
  // a mod without main.js (assets only) has nothing to check
  if (list.some((f) => f.file === "main.js")) files.push({ name, list });
}

const keywords = new Set(["for", "if", "while", "switch", "catch", "return", "else", "try", "do", "function", "with"]);
const methods = (src) => [...src.matchAll(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
const calls = (src) => [...src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
// Context methods are snake_case. `cx.stopPropagation()` is not a host call at
// all: it threw on the footer buttons, which looked like the window-drag strip
// eating the press.
const badContext = (src) => [...src.matchAll(/\bcx\.([a-z]+[A-Z][\w$]*)\s*\(/g)].map((m) => m[1]);

let bad = 0;
for (const { name, list } of files) {
  const defined = new Set(list.flatMap((f) => methods(f.src)));
  const used = new Set(list.flatMap((f) => calls(f.src)));
  for (const { file, src } of list) {
    // One name, one body in a file: a second definition silently replaces the
    // first, so the dead copy still reads as live code (askStop was written
    // twice, byte for byte).
    const counts = new Map();
    for (const method of methods(src)) counts.set(method, (counts.get(method) ?? 0) + 1);
    for (const [method, n] of counts) {
      if (n > 1 && !keywords.has(method) && used.has(method)) {
        console.log(`${name}/${file}: ${method}() is defined ${n} times`);
        bad++;
      }
    }
    for (const method of badContext(src)) {
      console.log(`${name}/${file}: cx.${method}() is not a host method`);
      bad++;
    }
  }
  for (const method of used) {
    if (defined.has(method)) continue;
    console.log(`${name}: this.${method}() is never defined`);
    bad++;
  }
}

console.log(bad ? `\n${bad} method problem(s)` : `every this.* call is defined in ${files.length} mods, each method once per file, every cx.* call real`);
process.exit(bad ? 1 : 0);
