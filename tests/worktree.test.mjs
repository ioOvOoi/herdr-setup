// Where worktrees hang, and the name they keep.
//
// The failures this guards against:
//
//   1. The find sheet's tree was a second copy of the sidebar's, and it silently
//      fell over (three helpers were not imported), so every worktree space read
//      as a bare row under IDLE instead of nested under its repo.
//   2. A terminal that cd'd out of its checkout made the space stop being a
//      worktree: it detached from its repo and Herdr renamed it after the new
//      folder ("test" became "tmp").
//   3. A checkout that already had a space was also listed as an unopened
//      checkout, so every worktree appeared twice.
//   4. Opening a checkout from a row did not start anything: the space was made
//      unnamed, and the first `cd` renamed it away.
//
//   node tests/worktree.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.WORKTREE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const core = read("mods/agents-list/core.js");
const palette = read("mods/agents-list/palette.js");
const sidebar = read("mods/agents-list/sidebar.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !extra ? "" : ` — ${extra}`}`);
};

// A top-level function, from `export function name(` to its closing brace.
function lift(src, name) {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) throw new Error(`no function ${name}`);
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(at, i + 1).replace(/^export /, "");
  }
  throw new Error(`unbalanced ${name}`);
}
const constant = (name) => {
  const at = core.indexOf(`export const ${name} =`);
  if (at < 0) throw new Error(`no const ${name}`);
  const end = core.indexOf(";", at) + 1;
  return core.slice(at, end).replace(/^export /, "");
};

const norm = (p) => (p ?? "").replace(/\\/g, "/");
const base = (p) => norm(p).replace(/\/+$/, "").split("/").pop() ?? "";
const factory = new Function("norm", "base", "shared", "place",
  `${constant("inside")}\n${lift(core, "openSpaceFor")}\n${lift(core, "worktreeTree")}\n
   return { openSpaceFor, worktreeTree, inside };`);
const shared = () => undefined;

const main = "/home/taha/Projects/oss/cliamp";
const tree = "/home/taha/.herdr/worktrees/cliamp/test";
const other = "/home/taha/.herdr/worktrees/cliamp/fglkdfg";
const repo = { id: "r", name: "cliamp", folder: "/home/taha/.config/herdr-app", live: main, machine: null };
// A worktree whose shell cd'd out: place() says /tmp, its folder says the checkout.
const wt = { id: "t", name: "tmp", folder: tree, live: "/tmp", machine: null };

const make = (spaces, trees) => factory(norm, base, shared, (s) => (s.live ?? s.folder)).worktreeTree(
  spaces,
  (s) => (s.id === "r"
    ? { main, root: main, linked: false, branch: "main" }
    : s.id === "t"
      ? { main, root: tree, linked: true, branch: "test" }
      : null),
  trees,
);

const checkouts = [
  { path: main, branch: "main", main: true, on: null, repoMain: main },
  { path: other, branch: "fglkdfg", main: false, on: null, repoMain: main },
  { path: tree, branch: "test", main: false, on: null, repoMain: main },
];

const out = make([repo, wt], checkouts);
check("a worktree space hangs under the space that holds its repo",
  out.worktrees.has("t") && out.parents.get("t") === "r", JSON.stringify([...out.parents]));
check("an unopened checkout hangs there too, so the repo's line is whole",
  out.checkoutParents.get(`\u0000${other}`) === "r", JSON.stringify([...out.checkoutParents]));
check("a checkout that already has a space is not listed a second time",
  !out.checkoutParents.has(`\u0000${tree}`), JSON.stringify([...out.checkoutParents]));

// A shell that wandered off still finds the space standing in its checkout.
const { openSpaceFor } = factory(norm, base, shared, (s) => (s.live ?? s.folder));
check("opening a checkout goes to the space standing there, even after a cd",
  openSpaceFor(tree, null, [repo, wt], []).id === "t");
check("opening a checkout nobody stands in finds no space",
  !openSpaceFor(other, null, [repo, wt], []));

// Both views read the name from the checkout, not from Herdr's live name.
check("the sidebar names a row through the shared rule",
  /\.child\(this\.spaceName\(s\)\)/.test(sidebar));
check("the sheet names a row through the shared rule",
  /this\.label\(this\.spaceName\(s\)/.test(palette) && /\.child\(\[\.\.\.this\.spaceName\(s\)\]/.test(palette));
check("the sidebar answers with the checkout's branch",
  /worktreeName\(s\) \{[\s\S]{0,260}return g\?\.branch/.test(sidebar));
check("the sheet answers with the checkout's branch",
  /worktreeName\(s\) \{[\s\S]{0,260}return c\?\.branch/.test(palette));

// Opening a checkout names the new space, or Herdr renames it on the first cd.
check("opening a checkout names the space after its branch",
  /const name = r\.c\?\.branch \?\? r\.branch \?\? base\(r\.path\);[\s\S]{0,180}run\("space\.new", \{ folder: r\.path, name/.test(core));
check("the worktrees dialog names the space it opens too",
  /const name = c\.branch \?\? c\.path\.split\("\/"\)\.pop\(\);[\s\S]{0,120}run\("space\.new", \{ folder: c\.path, machine: this\.on, name \}\)/.test(read("mods/worktrees/main.js")));

// One tree, both views: neither keeps its own parent map builder.
check("the sidebar builds no tree of its own",
  !/const parentOf = \(s\) => \{[\s\S]{0,80}info\.get\(s\.id\)/.test(sidebar) && /worktreeTree\(allSpaces, gitOf, trees\)/.test(sidebar));
check("the sheet builds no tree of its own",
  /worktreeTree\(all, gitOf, checkoutList\)/.test(palette) && !/nextParent\.set/.test(palette));

console.log(failures ? `\n${failures} worktree check(s) failed` : "all worktree checks passed");
process.exit(failures ? 1 : 0);
