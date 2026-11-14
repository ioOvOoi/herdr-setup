// The shared reorder step, run against the code both views run.
//
// The failures this guards against:
//
//   1. A step read the rows as drawn. A move lands asynchronously, so two presses
//      close together read the same order twice, aimed at the same neighbour, and
//      the second did nothing — "it only moves one row".
//   2. A step with a search active read the ranked rows, where the row below is
//      not the next place, so a move could reverse itself.
//   3. A step at either end said nothing, which reads like a broken key.
//   4. The sheet and the sidebar grew two implementations of the step, and one
//      drifted from the other.
//
//   node tests/reorder.test.mjs
//   REORDER_ROOT=/some/other/checkout node tests/reorder.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.REORDER_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const core = read("mods/agents-list/core.js");
const palette = read("mods/agents-list/palette.js");
const sidebar = read("mods/agents-list/sidebar.js");

// A method's own text, from `  name(` to the first line that is just `  }`.
function from(src, where, name) {
  const at = src.indexOf(`  ${name}(`);
  if (at < 0) throw new Error(`${where}: no method ${name}`);
  const end = src.indexOf("\n  }", at) + 4;
  return src.slice(at, end).replace(`  ${name}(`, `function ${name}(`);
}
const method = (name) => from(core, "core.js", name);

let failures = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !extra ? "" : ` — ${extra}`}`);
};

const A = { id: "a", name: "alpha", machine: null };
const B = { id: "b", name: "beta", machine: null };
const C = { id: "c", name: "gamma", machine: null };

// A sheet with the real shared step, on a spaces() that only moves when the
// "app" applies it — so a test can press twice before the order has landed.
let order = [];
const runs = [];
function sheet() {
  const make = new Function("spaces", "run", `
    ${method("aimedReorder")}
    ${method("reorderStep")}
    ${method("landReorder")}
    ${method("stopReorder")}
    ${method("startReorder")}
    return function make() {
      return {
        reorderId: null, reorderDir: 0, reorderSteps: 0, reorderStepAt: 0,
        reorderAim: null, reorderHold: null, reorderIds: null, reorderAfter: null,
        reorderIds: () => spaces().map((s) => s.id),
        landBefore: () => {},
        aimedReorder, reorderStep, landReorder, stopReorder, startReorder,
      };
    };`);
  return make(() => order, (name, args) => runs.push({ name, ...args }))();
}

// ---- one step, one place -----------------------------------------------------
order = [A, B, C];
runs.length = 0;
let s = sheet();
s.reorderStep(C, -1);
check("reorder: up takes the place of the space above",
  runs.length === 1 && runs[0].name === "space.move" && runs[0].id === "c" && runs[0].index === 2,
  JSON.stringify(runs));

// ---- a second press before the order lands still steps -----------------------
// This is the reported bug: spaces() still reads [A, B, C] here.
runs.length = 0;
s.reorderStep(C, -1);
check("reorder: the next press steps from where the last one aimed",
  runs.length === 1 && runs[0].id === "c" && runs[0].index === 1, JSON.stringify(runs));

// ---- the note -----------------------------------------------------------------
order = [A, B, C];
s = sheet();
let last = null;
s.reorderAfter = (moved, step, total) => { last = [moved.name, step, total]; };
s.reorderStep(C, -1);
check("reorder: a step says where the space landed",
  last?.join(" ") === "gamma 2 3", String(last));

// ---- the ends -----------------------------------------------------------------
order = [A, B];
runs.length = 0;
s = sheet();
s.reorderStep(B, 1);
check("reorder: the last space does not wrap to the top", runs.length === 0, JSON.stringify(runs));
s.reorderStep(A, -1);
check("reorder: the first space does not wrap to the bottom", runs.length === 0, JSON.stringify(runs));

// ---- only a space row moves ---------------------------------------------------
// A worktree row is a checkout and an agent row is a running program; the keys do
// nothing on either, and neither offers the hint. Each view's beginReorder decides
// what can move; both hand it to the one shared startReorder.
{
  const beginPalette = new Function("spaces", `return (${from(palette, "palette.js", "beginReorder").replace("function beginReorder", "function beginReorder")});`);
  const runPalette = (sel) => {
    const moves = [];
    const self = {
      selected: () => sel,
      startReorder: (space, dir) => moves.push([space.id, dir]),
    };
    beginPalette(() => order).call(self, 1, null);
    return moves;
  };
  check("reorder: the sheet moves a space row", runPalette({ kind: "space", s: A }).length === 1, "no move");
  check("reorder: the sheet does not move an agent row",
    runPalette({ kind: "agent", a: { space: "a", address: "t1" } }).length === 0, "moved");
  check("reorder: the sheet does not move a worktree row", runPalette({ kind: "worktree" }).length === 0, "moved");
  check("reorder: the sheet does not move a pin row", runPalette({ kind: "pin" }).length === 0, "moved");

  const beginSidebar = new Function("spaces", `return (${from(sidebar, "sidebar.js", "beginReorder")});`);
  const runSidebar = (entry) => {
    const moves = [];
    const self = {
      entry: () => entry,
      spaceOf: (e) => (e?.kind === "space" ? A : null),
      drawnSpaces: () => [A],
      startReorder: (space, dir) => moves.push([space.id, dir]),
      sel: null,
    };
    beginSidebar(() => order).call(self, 1, null);
    return moves;
  };
  check("reorder: the sidebar moves a space row", runSidebar({ kind: "space", id: "a", sect: 1 }).length === 1, "no move");
  check("reorder: the sidebar does not move a linked checkout's space",
    runSidebar({ kind: "space", id: "a", sect: 1, linked: true }).length === 0, "moved");
  check("reorder: the sidebar does not move a checkout row",
    runSidebar({ kind: "checkout", path: "/w", sect: 1 }).length === 0, "moved");
}

// ---- the aim is dropped when the spaces change under it ----------------------
order = [A, B, C];
s = sheet();
s.reorderStep(C, -1);
order = [A, B, C, { id: "d", name: "delta", machine: null }]; // someone opened a space
runs.length = 0;
s.reorderStep(C, -1);
check("reorder: a new space in the list is read at once, not from the old aim",
  runs.length === 1 && runs[0].index === 2, JSON.stringify(runs));

// ---- a step long after the last one reads the app's order --------------------
order = [A, B, C];
s = sheet();
s.reorderStep(C, -1);                       // aim: [A, C, B]
const realNow = Date.now;
Date.now = () => realNow() + 5000;          // the app has had time; it says [A, B, C]
order = [A, B, C];
runs.length = 0;
s.reorderStep(C, -1);
Date.now = realNow;
check("reorder: an old aim is not used once a step is long past",
  runs.length === 1 && runs[0].index === 2, JSON.stringify(runs));

// ---- crossing the pinned line is a pin or an unpin ----------------------------
{
  const landBefore = from(palette, "palette.js", "landBefore");
  const pinned = new Set(["a"]);
  const pins = [];
  const self = {
    spacePin: (s) => (pinned.has(s.id) ? { id: s.id } : null),
    setPin: (s) => pins.push(s.id),
  };
  new Function(`return (${landBefore});`)().call(self, A, B);
  check("reorder: the sheet pins a space stepped across the pinned line", pins.join() === "a", pins.join());
}

console.log(failures ? `\n${failures} failed` : "\nall reorder checks passed");
process.exit(failures ? 1 : 0);
