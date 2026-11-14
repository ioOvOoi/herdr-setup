// The keys both views share: Shift has to be read before plain Ctrl.
//
// The bug this guards against: the plain Ctrl+J/K branch sat above the
// Ctrl+Shift+J/K pair and never asked about Shift, so the reorder keys were
// unreachable — pressing them walked the highlight, which looks like nothing
// happened. The order of two branches in a long else-if chain is invisible in
// review and invisible to every other test, and it costs a person their keys.
//
// Now the map lives once, in workspace-engine.js, and both views call it. A view that wrote
// its own map again — the thing this test exists for — is caught here too.
//
//   node tests/keys.test.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.PALETTE_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8");
const core = read("mods/agents-list/workspace-engine.js");
const palette = read("mods/agents-list/palette.js");
const side = read("mods/agents-list/sidebar.js");
const foot = read("mods/footer/main.js");
const host = read("mods/handle/main.js");
const sheet = read("mods/shortcuts/main.js");

let failures = 0;
const check = (label, ok, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok || !extra ? "" : ` — ${extra}`}`);
};

// The shared key map: Shift must be asked first.
const at = (needle) => core.indexOf(needle);
const shiftBranch = at('if (m.shift && (k === "j" || k === "k"))');
const walkBranch = at('if (k === "j" || k === "k")');
const pin = at('if (k === "p")');
const rename = at('if (k === "r")');
const close = at('if (k === "d")');
const worktree = at('if (k === "a")');
check("Ctrl+Shift+J/K reorders", shiftBranch > 0);
check("the plain Ctrl+J/K branch comes after it", walkBranch > 0 && shiftBranch < walkBranch,
  "Ctrl+Shift+J/K would be swallowed by the Ctrl+J/K branch");
check("the reorder branch calls beginReorder", /if \(m\.shift[\s\S]{0,420}this\.beginReorder\(/.test(core));
// The OS key repeat is not a second source of steps: `startReorder` repeats the
// held step itself, and counting both made a held key move two rows at a time.
check("a held key does not step twice per repeat", /if \(!e\.is_held\) this\.beginReorder\(/.test(core));
check("the walk branch calls walk", /if \(k === "j" \|\| k === "k"\)[\s\S]{0,80}this\.walk\(/.test(core));
check("the sheet's other chords are in the shared map",
  pin > 0 && rename > 0 && close > 0 && worktree > 0);
check("the shared map is one function, used by both views",
  /this\.chord\(e, cx\)/.test(palette) && /this\.chord\(e, cx\)/.test(side));
check("a shifted Ctrl chord other than J/K is left to the app",
  /if \(m\.shift\) return false;/.test(core),
  "Ctrl+Shift+P and Ctrl+Shift+D would be swallowed by the panel");

// The sheet's key handler runs the shared map before its typing branches.
const sheetChord = palette.indexOf("if (this.chord(e, cx))");
const sheetType = palette.indexOf('k.length === 1 && !ctrl');
check("the sheet reads the shared map before typing", sheetChord > 0 && sheetType > sheetChord);
check("typing does not take the platform chord",
  /k\.length === 1 && !ctrl && !e\.modifiers\.alt && !e\.modifiers\.platform/.test(palette),
  "Cmd+C on macOS would type a c instead of copying");

// The sidebar's plain keys are handled after its modifier return, so the shared
// map must run before that return or the chords fall through to the app.
const sideChord = side.indexOf("if (this.chord(e, cx))");
const sideReturn = side.indexOf("if (m.control || m.alt || m.platform) return;");
check("the sidebar reads the shared map before the modifier return",
  sideChord > 0 && sideReturn > 0 && sideChord < sideReturn,
  "the chords would fall through to the app");

// Ctrl+J/K are bound to the handle's dir commands. The footer and the terminals
// list are hidden with the sidebar and again on the rail, so they never see the
// key then. The left handle stays shown and hands the walk back. The footer
// keeps the same hand-off for a key someone rebound onto it.
check("the handle gives Ctrl+J/K to the sidebar while it has the keyboard",
  /else if \(shared\("sidebar\.kb"\)\) setShared\("sidebar\.move"/.test(host));
check("only the left handle listens, so the two copies do not both step",
  /edge !== "left"/.test(host) && /nextCommand\(/.test(host) && /tries < 20/.test(host));
check("the layout points the walk, the flip and the closes at the handle",
  JSON.parse(read("keys.json"))["layout:workspace"]["ctrl-j"] === "handle.dir_down"
  && JSON.parse(read("keys.json"))["layout:workspace"]["ctrl-shift-m"] === "handle.flip_layout"
  && JSON.parse(read("keys.json"))["layout:workspace"]["ctrl-shift-x"] === "handle.close_pane");
check("the footer still hands a rebound Ctrl+J/K to the sidebar",
  /else if \(shared\("sidebar\.kb"\)\) setShared\("sidebar\.move"/.test(foot));
check("the keys sheet drops a global binding a layout section replaces",
  /b\.section === "global" && layoutKeys\.has\(b\.keys\)/.test(sheet));
check("a sub-agent fold is painted with the theme it closes over",
  /plainFold\(t, a, subs\)/.test(side) && /this\.plainFold\(t, a, subs\)/.test(side));
check("an agent row never focuses a missing pane",
  !/pane\.focus", \{ pane: a\.pane \}/.test(side) && /this\.focusAgent\(a\)/.test(side));
check("the sidebar says where the keyboard is",
  /setShared\("sidebar\.kb", here\)/.test(side));
check("the sidebar polls for the handed-back walk only while focused",
  /watchMoves\(cx, here\)/.test(side) && /watchWalk\(cx, on, "sidebar\.move"\)/.test(side));
check("the sheet polls the same hand-off",
  /watchWalk\(cx, true, "search\.move"\)/.test(palette));

// Adding or removing a space makes Herdr focus the new terminal. The list asked
// for it, so it takes the keyboard back, in steps as the app settles.
check("a space made from the list keeps the keyboard there",
  /run\("space\.new"\); this\.reclaim\(cx\)/.test(side)
  && /if \(this\.kb\(\)\) this\.reclaim\(cx\)/.test(side));
check("the sidebar claims the keyboard again as the app settles",
  /reclaim\(cx\) \{[\s\S]{0,120}\[40, 140, 340, 700\]/.test(side));
check("a held key ends when it is let go",
  /on_key_up\(\(e\) => \{ if \(e\.key === "j" \|\| e\.key === "k"\) this\.stopReorder\(\); \}\)/.test(palette)
  && /on_key_up\(\(e\) => \{ if \(e\.key === "j" \|\| e\.key === "k"\) this\.stopReorder\(\); \}\)/.test(side));
check("a press outside the sidebar ends keyboard mode",
  /on_mouse_down_out\(\(_e, cx\) => this\.blur\(cx\)\)/.test(side));
check("a press inside it comes back",
  /on_mouse_down\("left", \(_e, cx\) => this\.touch\(cx\)\)/.test(side));
check("a blur wins over a stale focused handle",
  /if \(this\.blurred\) return false;/.test(side));
check("opening a row lets the app's own focus stand, not the pane it came from",
  /afterOpen\(cx\) \{[\s\S]{0,360}this\.release\(cx\)/.test(side)
  && !/afterOpen\(cx\) \{[\s\S]{0,120}this\.leave\(cx\)/.test(side));
check("letting go of the keyboard does not ask for a pane",
  /release\(cx\) \{[\s\S]{0,320}?\n  \}/.test(side) && !/release\(cx\) \{[\s\S]{0,260}pane\.focus/.test(side));
check("the step itself is shared, not copied into a view",
  /startReorder\(s, dir, opts, cx\)/.test(core) && !/startReorder\(s, dir, opts, cx\)/.test(palette)
  && !/startReorder\(s, dir, opts, cx\)/.test(side));

console.log(failures ? `\n${failures} key check(s) failed` : "all key checks passed");
process.exit(failures ? 1 : 0);
