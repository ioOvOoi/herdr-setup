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
const core = read("mods/agents-list/workspace-engine.js");
const palette = read("mods/agents-list/palette.js");
const sidebar = read("mods/agents-list/sidebar.js");

// A method's own text, from `  name(` to the first line that is just `  }`.
function from(src, where, name) {
  const at = src.indexOf(`  ${name}(`);
  if (at < 0) throw new Error(`${where}: no method ${name}`);
  const end = src.indexOf("\n  }", at) + 4;
  return src.slice(at, end).replace(`  ${name}(`, `function ${name}(`);
}
const method = (name) => from(core, "workspace-engine.js", name);

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
// What `spaces()` reports. It stays behind `order` while a move is in flight,
// the way the app's read does: the model it hands out is the order before the
// last `space.move` landed.
let visible = null;
const spacesNow = () => visible ?? order;
const runs = [];

// The app's side of `space.move`: the space goes to that 1-based position in
// its own machine block. It lands at once, so `order` is the truth while
// `visible` is what the mod can still see.
function applyMove(id, index) {
  const held = order.find((x) => x.id === id);
  if (!held) return;
  const rest = order.filter((x) => x.id !== id);
  rest.splice(Math.max(0, Math.min(rest.length, index - 1)), 0, held);
  order = rest;
}

function sheet() {
  const make = new Function("spaces", "run", "machineIndexOf", `
    ${method("predictedSpaces")}
    ${method("noteSpaceMove")}
    ${method("aimedReorder")}
    ${method("reorderStep")}
    ${method("landReorder")}
    ${method("stopReorder")}
    ${method("startReorder")}
    return function make() {
      return {
        reorderId: null, reorderDir: 0, reorderSteps: 0, reorderStepAt: 0,
        reorderAim: null, reorderRaw: null, reorderRawAt: 0, reorderHold: null,
        reorderIds: null, reorderAfter: null,
        reorderIds: (list = spaces()) => list.map((s) => s.id),
        landBefore: () => {},
        predictedSpaces, noteSpaceMove, aimedReorder, reorderStep, landReorder,
        stopReorder, startReorder,
      };
    };`);
  const indexOf = (all, machine, id) => {
    const list = all.filter((s) => (s.machine ?? null) === (machine ?? null));
    const at = list.findIndex((s) => s.id === id);
    return at < 0 ? null : at + 1;
  };
  return make(spacesNow, (name, args) => {
    runs.push({ name, ...args });
    if (name === "space.move") applyMove(args.id, args.index);
  }, indexOf)();
}

// ---- one step, one place -----------------------------------------------------
order = [A, B, C];
visible = null;
runs.length = 0;
let s = sheet();
s.reorderStep(C, -1);
check("reorder: up takes the place of the space above",
  runs.length === 1 && runs[0].name === "space.move" && runs[0].id === "c" && runs[0].index === 2,
  JSON.stringify(runs));

// ---- a second press before the order lands still steps -----------------------
// `spaces()` still reads [A, B, C] here; the step must be aimed from the order
// the app will have, or its index is applied to the wrong list.
runs.length = 0;
visible = [A, B, C];
s.reorderStep(C, -1);
check("reorder: the next press steps from where the last one aimed",
  runs.length === 1 && runs[0].id === "c" && runs[0].index === 1, JSON.stringify(runs));
check("reorder: the two steps left the order the aim described",
  order.map((x) => x.id).join(",") === "c,a,b", JSON.stringify(order.map((x) => x.id)));

// ---- the note -----------------------------------------------------------------
order = [A, B, C];
visible = null;
s = sheet();
let last = null;
s.reorderAfter = (moved, step, total) => { last = [moved.name, step, total]; };
s.reorderStep(C, -1);
check("reorder: a step says where the space landed",
  last?.join(" ") === "gamma 2 3", String(last));

// ---- the ends -----------------------------------------------------------------
order = [A, B];
visible = null;
runs.length = 0;
s = sheet();
s.reorderStep(B, 1);
check("reorder: the last space does not wrap to the top", runs.length === 0, JSON.stringify(runs));
s.reorderStep(A, -1);
check("reorder: the first space does not wrap to the bottom", runs.length === 0, JSON.stringify(runs));

// ---- only a space row moves with space.move ----------------------------------
// A worktree row is a checkout: it steps inside its repo group (`startPathReorder`,
// the persisted worktree order), never through `space.move`. An agent row and a
// pin row do nothing. Each view's beginReorder decides; both hand the work to a
// shared engine method.
{
  const beginPalette = new Function("spaces", `return (${from(palette, "palette.js", "beginReorder").replace("function beginReorder", "function beginReorder")});`);
  const runPalette = (sel, opts = {}) => {
    const moves = [];
    const paths = [];
    const self = {
      selected: () => sel,
      reorderSubject: () => opts.held ?? null,
      pathSubject: () => opts.moving ?? null,
      pathGroup: opts.group ?? null,
      pathPaths: opts.paths ?? null,
      pathAfter: opts.after ?? null,
      isWorktree: (s) => Boolean(s?.worktree || s?.linked),
      startReorder: (space, dir) => moves.push([space.id, dir]),
      startPathReorder: (group, path, list, dir) => paths.push([path, dir]),
      reorderWorktreeRow: (row, dir) => paths.push([row.kind, dir]),
    };
    beginPalette(() => order).call(self, 1, null);
    return { moves, paths };
  };
  check("reorder: the sheet moves a space row", runPalette({ kind: "space", s: A }).moves.length === 1, "no move");
  check("reorder: the sheet does not move an agent row",
    runPalette({ kind: "agent", a: { space: "a", address: "t1" } }).moves.length === 0, "moved");
  check("reorder: the sheet steps a worktree row inside its group",
    runPalette({ kind: "worktree", c: { path: "/w" } }).paths.length === 1, "no step");
  check("reorder: the sheet steps an opened worktree space inside its group",
    runPalette({ kind: "space", s: { ...A, worktree: true } }).paths.length === 1, "no step");
  check("reorder: the sheet does not move a pin row", runPalette({ kind: "pin" }).moves.length === 0, "moved");
  // A press that lands before the sheet repainted still names the old row index,
  // which is now a different space. The step must keep moving the space the
  // reorder is about — otherwise a held key walks two spaces at once.
  check("reorder: a step in flight keeps moving its own space, not the row its index names",
    JSON.stringify(runPalette({ kind: "space", s: A }, { held: B }).moves) === '[["b",1]]',
    JSON.stringify(runPalette({ kind: "space", s: A }, { held: B }).moves));
  check("reorder: a checkout step in flight keeps stepping its own path",
    JSON.stringify(runPalette({ kind: "space", s: A }, { moving: "/w", group: "g", paths: ["/w", "/x"] }).paths)
      === '[["/w",1]]',
    JSON.stringify(runPalette({ kind: "space", s: A }, { moving: "/w", group: "g", paths: ["/w", "/x"] }).paths));

  const beginSidebar = new Function("spaces", `return (${from(sidebar, "sidebar.js", "beginReorder")});`);
  const runSidebar = (entry, opts = {}) => {
    const moves = [];
    const paths = [];
    const row = (e) => (e?.kind === "checkout" ? { kind: "checkout", path: e.path, on: null }
      : e?.linked ? { kind: "space", s: { ...A, id: e.id, linked: true } }
        : e?.kind === "space" ? { kind: "space", s: B } : null);
    const self = {
      entry: () => entry,
      sidebarRow: row,
      reorderSubject: () => opts.held ?? null,
      pathSubject: () => opts.moving ?? null,
      pathGroup: opts.group ?? null,
      pathPaths: opts.paths ?? null,
      pathAfter: opts.after ?? null,
      isWorktree: (s) => Boolean(s?.worktree || s?.linked),
      drawnSpaces: () => [B],
      startReorder: (space, dir) => moves.push([space.id, dir]),
      startPathReorder: (group, path, list, dir) => paths.push([path, dir]),
      reorderWorktreeRow: (r, e, dir) => paths.push([e.kind, dir]),
      sel: null,
    };
    beginSidebar(() => order).call(self, 1, null);
    return { moves, paths };
  };
  check("reorder: the sidebar moves a space row", runSidebar({ kind: "space", id: "a", sect: 1 }).moves.length === 1, "no move");
  check("reorder: the sidebar steps a linked checkout's space inside its group",
    runSidebar({ kind: "space", id: "a", sect: 1, linked: true }).paths.length === 1, "no step");
  check("reorder: the sidebar steps a checkout row inside its group",
    runSidebar({ kind: "checkout", path: "/w", sect: 1 }).paths.length === 1, "no step");
  check("reorder: the sidebar keeps moving the space its reorder is about",
    JSON.stringify(runSidebar({ kind: "space", id: "a", sect: 1 }, { held: B }).moves) === '[["b",1]]',
    JSON.stringify(runSidebar({ kind: "space", id: "a", sect: 1 }, { held: B }).moves));
  check("reorder: the sidebar's space step list skips linked checkouts",
    /kind === "space" && e\.sect === sect && !e\.linked/.test(sidebar));
}

// ---- the aim is dropped when the spaces change under it ----------------------
order = [A, B, C];
visible = null;
s = sheet();
s.reorderStep(C, -1);
order = [A, B, C, { id: "d", name: "delta", machine: null }]; // someone opened a space
visible = null;
runs.length = 0;
s.reorderStep(C, -1);
check("reorder: a new space in the list is read at once, not from the old aim",
  runs.length === 1 && runs[0].index === 2, JSON.stringify(runs));

// ---- a step long after the last one reads the app's order --------------------
order = [A, B, C];
visible = null;
s = sheet();
s.reorderStep(C, -1);                       // aim: [A, C, B]
const realNow = Date.now;
Date.now = () => realNow() + 5000;          // the app has had time; it says [A, B, C]
order = [A, B, C];
visible = null;
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
