// One logic, two views.
//
// The sidebar and the find sheet are the same thing twice: the same places,
// pins, removals, worktrees and space order, drawn once as a list that stays
// open and once as a sheet that opens over it. Herdr only lets a mod import its
// own folder, so they are one mod here, and this file is the one copy of what
// they both do.
//
// A rule belongs here when both views need it: where a space is, what a pin is,
// what is on its way out, how a step lands, what Ctrl+D does to a row. What is
// left in palette.js and sidebar.js is how each one draws and walks its own
// rows.
import { View, div } from "gpui-kit";
import { spaces, panes, agents, run, shared, setShared, notify, keys, openOverlay, exec } from "herdr";

// The sidebar's avatar colours, so a space looks the same in both places.
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
export const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];

// A theme colour with alpha, so every tint follows the theme's own light and dark.
export const wash = (c, a = "14") => (/^#[0-9a-fA-F]{6}$/.test(c ?? "") ? c + a : c);

// A program's tile keeps its own colour, drawn solid: washed over the theme
// background it would look different in every theme, and a program's mark should
// not. Its glyph takes the program's colour, or whichever of black and white the
// tile can carry.
export const tileOf = (p) => (p?.tile && /^#[0-9a-fA-F]{6}$/.test(p.tile) ? p.tile : null);
export const inkOf = (p) => {
  if (p?.color) return p.color;
  const tile = tileOf(p);
  if (!tile) return null;
  const n = parseInt(tile.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#121212" : "#ffffff";
};

// A small keyboard cap, so shortcuts read as keys rather than as prose.
export const keycap = (t, label, tone = t.muted) => div().flex_none().h(18).px(5).rounded(4)
  .bg(wash(t.foreground, "10")).border(1).border_color(wash(t.foreground, "1c"))
  .text_size(9.5).font_medium().text_color(tone).flex().items_center().child(label);

// The query, drawn where it lands. A match keeps the row's colour and takes the
// weight; the rest steps back. Only on a short label: a long one is truncated,
// and pieces cannot ellipsize as one line.
export const marks = (text, terms) => {
  const s = String(text ?? "");
  if (!terms?.length || s.length > 30) return null;
  const lower = s.toLowerCase();
  const hits = [];
  for (const term of terms) {
    for (let i = lower.indexOf(term); i >= 0 && hits.length < 32; i = lower.indexOf(term, i + term.length)) {
      hits.push([i, i + term.length]);
    }
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a[0] - b[0]);
  const run = [];
  for (const [a, b] of hits) {
    const last = run.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else run.push([a, b]);
  }
  const parts = [];
  let at = 0;
  for (const [a, b] of run) {
    if (a > at) parts.push([s.slice(at, a), false]);
    if (b > a) parts.push([s.slice(a, b), true]);
    at = b;
  }
  if (at < s.length) parts.push([s.slice(at), false]);
  return parts;
};

// Space colours, kept by space id in shared "space.colors". The least used
// colour wins, so two neighbouring spaces rarely share one.
export function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
export function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

// The key bound to a command, for an action row ("ctrl-shift-n" -> "Ctrl+Shift+N").
export function shortcutOf(command) {
  // The shortest binding: a command on both Ctrl+N and Ctrl+Shift+N reads as
  // Ctrl+N, the key people reach for.
  const fewest = (a, b) => a.keys.split("-").length - b.keys.split("-").length;
  const all = keys().filter((b) => b.action === command).sort(fewest);
  const binding = all.find((b) => b.section !== "terminal") ?? all[0];
  if (!binding) return "";
  return binding.keys.split("-").map((part) => {
    const word = { ctrl: "Ctrl", shift: "Shift", alt: "Alt", cmd: "Cmd", super: "Super" }[part];
    return word ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1));
  }).join("+");
}

// Where a space is now: its first terminal's live folder, else where it was made.
export function place(s, all = panes()) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return all.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

// Checkouts the worktrees dialog has already taken off the list. It hides one on
// confirm and the sidebar does the git work behind it, so neither view may offer
// a row that is on its way out as if it were still there.
export const removingList = () => {
  const list = shared("worktree.removing");
  if (!Array.isArray(list)) return [];
  const since = Date.now() - 5 * 60_000;
  return list.filter((r) => (r.at ?? 0) > since);
};
export const isRemoving = (path, machine) => Boolean(path) && removingList()
  .some((r) => (r.machine ?? null) === (machine ?? null) && tidyPath(r.path) === tidyPath(path));

// The space already standing in a folder — the same place, not one of its
// subfolders. A pin is a place, so this is what says "there is a space here".
export function spaceAt(folder, on, all = spaces(), ps = panes()) {
  const f = norm(folder);
  if (!f) return null;
  // Either where a terminal is now or the folder the space was made in: a space
  // whose shell has cd'd somewhere else still stands in its own folder.
  return all.find((s) => (s.machine ?? null) === (on ?? null)
    && (norm(place(s, ps) ?? "") === f || norm(s.folder ?? "") === f)) ?? null;
}

export async function git(cwd, args, on, timeout) {
  const r = await exec("git", args, { cwd, on, ...(timeout === undefined ? {} : { timeout }) });
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The repo a folder belongs to: main checkout, name, and whether this is a linked worktree.
export async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

// Every checkout of a repo, the main one first, then most recently committed.
// The sidebar and the sheet both read the same git answer through this.
export async function checkouts(repo, on) {
  const list = await git(repo.main, ["worktree", "list", "--porcelain"], on);
  if (!list.ok) return [];
  const refs = await git(repo.main, ["for-each-ref", "--format=%(refname:short)%09%(committerdate:unix)", "refs/heads"], on);
  const when = new Map(refs.out.split("\n").filter(Boolean).map((l) => l.split("\t")).map(([b, at]) => [b, Number(at) || 0]));
  const out = [];
  for (const block of list.out.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l === "bare" || l.startsWith("prunable"))) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0, at: branch ? (when.get(branch) ?? 0) : 0 });
  }
  return out.sort((a, b) => b.main - a.main || b.at - a.at);
}

export const norm = (p) => (p ?? "").replace(/\\/g, "/");
export const tidyPath = (p) => norm(p).replace(/\/+$/, "");
export const base = (p) => norm(p).replace(/\/+$/, "").split("/").pop() ?? "";

// A pin with no live space opens a new space in its folder, and Herdr names a
// space after the folder it starts in. So a pin row must read the name the click
// will give it, never the name the space had while it was open somewhere else:
// "reel" opening as "herdr-app" is a row that lied. A pin somebody named keeps
// that name, because opening it asks for the name too.
export const pinLabel = (p) => (p?.named && p.name ? p.name : base(p?.folder));
export const inside = (p, dir) => p === dir || p.startsWith(dir.replace(/\/+$/, "") + "/");

// The colour a saved space keeps while it has no terminals: from its folder,
// so the same pin reads the same across restarts.
export function folderColor(folder) {
  let h = 0;
  for (const ch of norm(folder)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PROJECT_COLORS[h % PROJECT_COLORS.length];
}

// Herdr keeps linked checkouts at <home>/worktrees/<repo>/<branch>, so a space
// standing there is a worktree even before git has answered for it. The sidebar
// and the sheet read the same path, so neither can call it a space of its own.
export const inWorktrees = (folder) => /(?:^|\/)worktrees\/[^/]+\/[^/]+\/?$/.test(norm(folder ?? ""));

// Pinned spaces: the id is what a pin belongs to, the folder is what lets it
// still open a shell once its space is gone. A pin is never dropped for missing
// a field (that would lose it on the next write): an id alone is enough.
export function pinnedList() {
  const list = shared("spaces.pinned");
  return Array.isArray(list) ? list.filter((p) => p && (p.id || p.folder)) : [];
}

// A pinned space is never closed. The same rule, spelled the same way, in the
// sidebar, the dialogs and here: a pin names its space by id, or — pins saved
// before ids — by the place it was pinned at.
export const isPinned = (s) => Boolean(s?.id) && pinnedList().some((p) => (p.id
  ? p.id === s.id
  : (p.machine ?? null) === (s.machine ?? null) && norm(place(s) ?? s.folder ?? "") === norm(p.folder)));

// Every pin write goes through here, and a shrinking list is said out loud: a
// pin that vanishes without a line in the log came from another mod.
export function writePins(next, why) {
  const before = pinnedList();
  if (next.length < before.length) console.log(`pins ${before.length} -> ${next.length} (${why})`);
  setShared("spaces.pinned", next);
}
export const pinKey = (folder, on) => `${on ?? ""}\u0000${norm(folder ?? "")}`;
// Two reads of the same pin are two objects, so a pin is matched by its id, else
// by the folder and machine it was saved with.
export const samePin = (a, b) => (a?.id && b?.id
  ? a.id === b.id
  : a?.id === b?.id && pinKey(a?.folder, a?.machine) === pinKey(b?.folder, b?.machine));

// The space already showing a checkout, if any. The space's live place is asked
// first, then the folder it was made in: a shell that cd'd out of its worktree is
// still the space standing in it, and opening the checkout again must go there
// rather than start a duplicate.
export function openSpaceFor(path, on, all = spaces(), ps = panes()) {
  const target = norm(path);
  return all.find((s) => (s.machine ?? null) === (on ?? null)
    && (inside(norm(place(s, ps)), target) || inside(norm(s.folder), target)));
}

// Where every checkout hangs: the one tree both views draw.
//
// A worktree space *is* a checkout, so it is drawn under the space that holds its
// repo, never as a space of its own — and it stays one when its shell cds
// somewhere else. A checkout nobody has opened is drawn there too, so a repo's
// line reads the same before and after opening one.
//
// `gitOf(s)` is the view's git answer for a space ({main, root, linked, branch});
// `trees` every checkout it can see ({path, branch, main, on, repoMain}).
export function worktreeTree(all, gitOf, trees) {
  const keyOf = (t) => `${t.on ?? ""}\u0000${t.path}`;
  const onOf = (s) => s.machine ?? null;
  // A space's checkout: git when it answered, else the path itself — a machine
  // still asleep, or the frame right after a checkout was made, has no answer yet
  // and must not read as a plain space in the meantime.
  const checkoutOf = (s) => {
    const g = gitOf(s);
    if (g?.main) {
      return { main: norm(g.main), root: g.root ? norm(g.root) : null, linked: Boolean(g.linked), branch: g.branch ?? null };
    }
    const path = [place(s), s.folder].map(norm)
      .find((p) => /(?:^|\/)worktrees\/[^/]+\/[^/]+\/?$/.test(p)) ?? norm(place(s) ?? s.folder ?? "");
    const m = path.match(/(?:^|\/)worktrees\/([^/]+)\/[^/]+\/?$/);
    return m ? { main: null, root: path, linked: true, branch: null, name: m[1] } : null;
  };
  const checkout = new Map(all.map((s) => [s.id, checkoutOf(s)]));
  const owner = shared("worktree.owner");
  const ownerId = owner && Date.now() - (owner.at ?? 0) < 2 * 60000 ? owner.space : null;
  const folderOf = (s) => place(s) ?? s.folder ?? "";
  // The space that holds a repo: the one a checkout was just made from, else the
  // one named like the repo, else its first space. Never another checkout.
  const holder = (main, name, on, skip) => {
    const kin = all.filter((p) => p !== skip && (p.machine ?? null) === (on ?? null)
      && !checkout.get(p.id)?.linked
      && (main ? checkout.get(p.id)?.main === main : Boolean(name) && base(folderOf(p)) === name));
    return kin.find((p) => p.id === ownerId)
      ?? kin.find((p) => base(folderOf(p)) === (name ?? base(main ?? "")))
      ?? kin[0] ?? null;
  };
  const worktrees = new Set();
  const parents = new Map();
  for (const s of all) {
    const c = checkout.get(s.id);
    if (!c?.linked) continue;
    worktrees.add(s.id);
    const p = holder(c.main, c.main ? base(c.main) : c.name, onOf(s), s);
    if (p) parents.set(s.id, p.id);
  }
  // Which checkout paths are already spaces, so none is drawn twice.
  const opened = new Set();
  for (const s of all) {
    const c = checkout.get(s.id);
    if (c?.linked && c.root) opened.add(`${onOf(s) ?? ""}\u0000${c.root}`);
  }
  const checkoutParents = new Map();
  for (const t of trees) {
    if (t.main) continue;
    const key = keyOf(t);
    if (opened.has(key)) continue;
    const main = norm(t.repoMain ?? "");
    const p = holder(main, base(main), t.on ?? null, null);
    if (p) checkoutParents.set(key, p.id);
  }
  return { worktrees, parents, checkoutParents, keyOf };
}

export const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

// What both views inherit. Everything here is one rule with two callers: a pin,
// a removal, a worktree, a step, an action on the selected row.
export class Workspace extends View {
  // Called by both inits. The step state lives on the view, never at module
  // scope: two copies (the sidebar block and the open sheet) must not share one
  // held key.
  initShared() {
    this.reorderHold = null;
    this.reorderId = null;
    this.reorderDir = 0;
    this.reorderSteps = 0;
    this.reorderStepAt = 0;
    this.reorderAim = null;
    this.reorderIds = null;
    this.reorderAfter = null;
    this.walkTick = null;
    this.worktreeSpaces ??= new Set();
    this.bindPins();
  }

  // The pin of exactly this space, by its id. Two spaces can share a folder and
  // both be pinned, so the folder decides nothing here: a pin whose space is
  // gone stays a pin row (a place to open), and a space made later is never
  // handed that pin behind your back.
  spacePin(s) {
    if (!s) return null;
    return pinnedList().find((p) => p.id === s.id) ?? null;
  }

  // A pin saved before pins had ids is given one, once, when a view opens: it
  // was pinned as this folder, so the space living there is what it means. This
  // never runs for a pin that has an id — not even a stale one — because a new
  // space must not come up pinned.
  bindPins() {
    const list = pinnedList();
    const live = spaces();
    const held = new Set(list.filter((p) => p.id && live.some((s) => s.id === p.id)).map((p) => p.id));
    let changed = false;
    for (const p of list) {
      if (p.id) continue;
      const s = live.find((x) => !held.has(x.id)
        && (x.machine ?? null) === (p.machine ?? null)
        && norm(x.folder ?? "") === norm(p.folder));
      if (!s) continue;
      held.add(s.id);
      p.id = s.id;
      p.name = p.name || s.name;
      changed = true;
    }
    if (changed) writePins(list, "gave a pin without an id its space id");
    // A pin whose space is gone while another space stands in its folder has
    // nothing left to open: that folder is a space already. Kept, it is a second
    // row for one place, and pressing it would make a duplicate space — the
    // exact way a sheet ends up with three rows all reading "herdr-app".
    const kept = list.filter((p) => (p.id && live.some((s) => s.id === p.id)) || !spaceAt(p.folder, p.machine ?? null, live));
    if (kept.length !== list.length) writePins(kept, "dropped a pin whose place already is a space");
  }

  // One pin, by id: pinning a space never touches another space in its folder,
  // and unpinning removes exactly that pin. Pins are compared by value, never by
  // object: every read of shared state is a fresh copy. Pins are a toggle.
  setPin(s) {
    if (!s) return;
    // Where the space is now, not the folder it was made in: a space created in
    // one place and used in another is named after the second, and reopening the
    // pin must land there too.
    const folder = place(s) ?? s.folder;
    if (!folder) return;
    const list = pinnedList();
    const mine = this.spacePin(s);
    writePins(mine
      ? list.filter((p) => !samePin(p, mine))
      : [...list, { id: s.id, folder, machine: s.machine ?? null, name: s.name, named: Boolean(s.named) }],
      mine ? `unpinned ${s.name}` : `pinned ${s.name}`);
  }

  unpinPin(p) {
    if (!p) return;
    writePins(pinnedList().filter((x) => !samePin(x, p)), `unpinned the row ${p.name ?? p.folder ?? ""}`);
  }

  // A worktree space, decided without git wherever the path already says so. The
  // sidebar knows it from git, the sheet from its checkout scan; either answer
  // is enough, and both views ask this one method.
  isWorktree(s) {
    if (!s) return false;
    if (this.worktreeSpaces?.has(s.id)) return true;
    // Both where the space is now and where it was made: a worktree is a checkout
    // for good, and its shell wandering off does not make it a space again.
    if (inWorktrees(place(s)) || inWorktrees(s.folder)) return true;
    if (!this.git) return false;
    for (const folder of [place(s), s.folder]) {
      if (this.git[`${s.machine ?? ""}\u0000${folder ?? ""}`]?.linked) return true;
    }
    return false;
  }

  // The name a worktree space keeps: its branch, else its checkout folder. A
  // view answers this from its own git read; the default is `s.name`.
  worktreeName(_s) { return null; }

  // What a row is called. A worktree is named by its checkout, never by where its
  // shell happens to be, so cd-ing out of it cannot rename the row.
  spaceName(s) {
    return this.worktreeName(s) ?? s?.name ?? "";
  }

  // A checkout nobody has opened becomes a space there, named after its branch so
  // Herdr does not rename it the moment the shell changes directory.
  openCheckout(r) {
    if (!r?.path) return;
    const existing = openSpaceFor(r.path, r.on ?? null);
    if (existing) return this.openSpace(existing);
    const name = r.c?.branch ?? r.branch ?? base(r.path);
    run("space.new", { folder: r.path, name, ...(r.on ? { machine: r.on } : {}) });
  }

  // Opening a space with no terminal anywhere — no tabs, or only mod panes —
  // starts a shell there, so a pinned space whose terminal is gone still lands
  // you somewhere to type.
  openSpace(s) {
    const cur = spaces().find((x) => x.id === s.id) ?? s;
    run("space.select", { id: cur.id });
    const tabs = new Set((cur.tabs ?? []).map((t) => t.id));
    if (!panes().some((p) => p.terminal && tabs.has(p.tab))) run("tab.new", { space: cur.id });
  }

  // An agent's own pane when it has one (the listed agent wins over a stale row),
  // else the terminal address, else a peek: one rule for a click and for Enter.
  focusAgent(a) {
    if (!a) return;
    const listed = agents().find((x) => x.address === a.address);
    if (listed?.pane) return run("pane.focus", { pane: listed.pane });
    if (a.pane) return run("pane.focus", { pane: a.pane });
    run("terminal.peek", { terminal: a.address });
  }

  // The space a row belongs to: a space row is itself, an agent row the space it
  // runs in. A checkout owns none.
  spaceOfRow(r) {
    if (r?.kind === "space") return r.s ?? null;
    if (r?.kind === "agent") return spaces().find((x) => x.id === r.a?.space) ?? null;
    return null;
  }

  // How a view opens a dialog. The sidebar adds its own flag so it can take the
  // keyboard back when the dialog closes; an overlay over the sheet does not
  // need that. Both views call this, so every action asks in the same place.
  openDialog(opts) {
    openOverlay(opts);
  }

  // Hooks the views answer differently: the sheet closes before it acts; the
  // sidebar drops keyboard mode after, without pulling focus back to a pane.
  beforeOpen() {}
  afterOpen() {}
  beforeRename() {}
  beforeWorktree() {}

  // Enter on a row, and a click on it: one implementation for both views.
  openRow(r, cx) {
    if (!r) return;
    this.beforeOpen(cx);
    if (r.kind === "space") {
      this.openSpace(r.s);
    } else if (r.kind === "pin") {
      // A pin is a place, not a licence for a second space in that place: go to
      // the space already there, and say why nothing new was opened.
      const p = r.pin;
      const existing = spaceAt(p.folder, p.machine ?? null);
      if (existing) {
        this.openSpace(existing);
        notify({
          title: "That folder already has a space",
          body: `${existing.name} is open there. Went to it instead of opening a second one.`,
          level: "warning",
        });
      } else run("space.new", { folder: p.folder, ...(p.named ? { name: p.name } : {}), ...(p.machine ? { machine: p.machine } : {}) });
    } else if (r.kind === "checkout") {
      this.openCheckout(r);
    } else if (r.kind === "agent") {
      this.focusAgent(r.a);
    }
    this.afterOpen(cx);
  }

  // Ctrl+D on an agent: never silent, and never on a sub-agent, which its parent
  // is waiting for. The dialog says what is lost; Enter stops, Esc keeps it.
  askStop(a) {
    if (!a) return;
    if (a.parent) return notify({ title: "A sub-agent ends with its parent", body: `${a.title || a.program?.name || a.address} reports to ${a.parent}.` });
    // The same dialog that asks about a space or a worktree; Esc leaves it.
    this.openDialog({ mod: "worktrees", kind: "dialog", width: 440, height: 156, props: { agent: a.address } });
  }

  // Ctrl+D on the selected row: close a space, remove a checkout, stop an agent,
  // or take a pin away. One rule for both views.
  closeRow(r) {
    if (!r) return;
    if (r.kind === "agent") return this.askStop(r.a);
    if (r.kind === "pin") return this.unpinPin(r.pin);
    if (r.kind === "checkout") {
      return this.openDialog({ mod: "worktrees", kind: "dialog", width: 440, height: 155,
        props: { folder: r.path, machine: r.on ?? null, action: "remove" } });
    }
    if (r.kind !== "space") return;
    const s = r.s;
    const tree = this.isWorktree(s);
    // A pinned space is never closed, and the view says so rather than opening a
    // dialog that could only refuse. A worktree's space is a checkout: removing
    // it stays on offer, pinned or not.
    if (!tree && isPinned(s)) return notify({
      title: "Pinned space",
      body: `${s.name} stays: pinned spaces are never closed. Unpin it (Ctrl+P), then close it.`,
    });
    // A worktree's checkout is the folder it was made in, not necessarily where
    // its shell is now: a `cd` out of the checkout must not point the removal at
    // some other repo (the dialog would then only say "not a worktree").
    const folder = tree ? (inWorktrees(s.folder) ? s.folder : (place(s) ?? s.folder)) : null;
    this.openDialog({ mod: "worktrees", kind: "dialog", width: 440, height: tree ? 155 : 150,
      props: { space: s.id, ...(folder ? { folder } : {}), action: tree ? "remove" : "space" } });
  }

  // Ctrl+P on the selected row.
  pinRow(r) {
    if (!r) return;
    if (r.kind === "pin") return this.unpinPin(r.pin);
    if (r.kind === "agent") return this.setPin(this.spaceOfRow(r));
    if (r.kind !== "space") return;
    // A pin belongs to a space; a worktree is a checkout under its repo.
    if (this.isWorktree(r.s)) return notify({
      title: "A worktree is not pinned",
      body: `${r.s.name} lives under its repo. Pins belong to spaces.`,
    });
    this.setPin(r.s);
  }

  // Ctrl+A on the selected row: a worktree of the row — its checkout if the row
  // is one, else the repo of the space it belongs to (an agent row works on its
  // space).
  worktreeRow(r) {
    if (!r) return;
    if (r.kind === "checkout") {
      return this.openDialog({ mod: "worktrees", kind: "dialog", width: 460, height: 170,
        props: { folder: r.path, machine: r.on ?? null, action: "new" } });
    }
    const s = this.spaceOfRow(r);
    if (!s) return;
    this.beforeWorktree(s);
    this.openDialog({ mod: "worktrees", kind: "dialog", width: 460, height: 170,
      props: { space: s.id, folder: place(s) ?? s.folder, action: "new" } });
  }

  // Ctrl+R on the selected row: the app's own prompt, as the menu's Rename.
  renameRow(r) {
    if (r?.kind !== "space" || !r.s?.id) return;
    this.beforeRename();
    run("space.rename", { id: r.s.id });
  }

  // The find sheet's map, key for key, used by both views: walking with
  // Ctrl+J/K, reordering with Ctrl+Shift+J/K, pinning with Ctrl+P, renaming with
  // Ctrl+R, closing or removing with Ctrl+D, a worktree with Ctrl+A. Shift is
  // read before plain Ctrl — the other order makes the reorder keys unreachable.
  chord(e, cx) {
    const k = e.key;
    const m = e.modifiers ?? {};
    if (!m.control) return false;
    if (m.shift && (k === "j" || k === "k")) {
      this.beginReorder(k === "j" ? 1 : -1, cx);
      return true;
    }
    // Only Ctrl+Shift+J/K belong to the list. Other shifted chords are the
    // app's (`ctrl-shift-p` palette, `ctrl-shift-d` new worktree), and taking
    // them here meant they stopped working whenever the panel had the keyboard.
    if (m.shift) return false;
    if (k === "j" || k === "k") {
      this.walk(k === "j" ? 1 : -1, cx);
      return true;
    }
    if (k === "p") { this.pinRow(this.selectedRow()); return true; }
    if (k === "r") { this.renameRow(this.selectedRow()); return true; }
    if (k === "d") { this.closeRow(this.selectedRow()); return true; }
    if (k === "a") { this.worktreeRow(this.selectedRow()); return true; }
    return false;
  }

  // One step of a reorder, and the held repeat that follows it. The scope (which
  // spaces are being stepped through) is the caller's: the sheet steps through
  // every space, the sidebar only through the section under the selected row.
  startReorder(s, dir, opts, cx) {
    if (!s || !dir) return;
    // The key's own auto-repeat must not double-step the first press.
    if (this.reorderHold && this.reorderDir === dir && Date.now() - (this.reorderStepAt ?? 0) < 90) return;
    this.stopReorder();
    this.reorderId = s.id;
    this.reorderDir = dir;
    this.reorderSteps = 0;
    this.reorderIds = opts.ids;
    this.reorderAfter = opts.after ?? null;
    this.reorderStep(s, dir);
    this.reorderHold = cx.timer.after(300, (cx2) => {
      this.reorderHold = cx2.timer.every(70, (cx3) => {
        const live = spaces().find((x) => x.id === this.reorderId);
        if (!live || ++this.reorderSteps > 600) return this.stopReorder();
        this.reorderStep(live, this.reorderDir);
        cx3.notify();
      });
    });
  }

  // The order the steps are aiming at. A move lands asynchronously, so two
  // presses close together would read the same list twice, aim at the same
  // neighbour and the second would do nothing. Read the aim while it still
  // describes the live set of spaces.
  aimedReorder() {
    const live = this.reorderIds?.() ?? [];
    const ids = this.reorderAim;
    // Only while a step may still be landing: an order changed from anywhere else
    // is read from the app, not remembered.
    const fresh = Date.now() - (this.reorderStepAt ?? 0) < 1200;
    return fresh && Array.isArray(ids) && ids.length === live.length && ids.every((id) => live.includes(id)) ? ids : live;
  }

  // Put `s` where `target` is, in `ids`. Pinned spaces read above the rest in
  // the sheet, so landing on the other side of that line is a pin or an unpin:
  // never a drop that does nothing. Returns the space's place in the aim, 1-based.
  landReorder(s, target, ids, dir = 0) {
    if (!s || !target || s.id === target.id) return null;
    const list = spaces().filter((x) => (x.machine ?? null) === (s.machine ?? null));
    const at = list.findIndex((x) => x.id === target.id);
    if (at < 0) return null;
    const rest = ids.filter((id) => id !== s.id);
    const ti = rest.indexOf(target.id);
    if (ti < 0) return null;
    const cut = ti + (dir > 0 ? 1 : 0);
    this.reorderAim = [...rest.slice(0, cut), s.id, ...rest.slice(cut)];
    this.landBefore(s, target);
    run("space.move", { id: s.id, index: at + 1 });
    return this.reorderAim.indexOf(s.id) + 1;
  }

  // The sheet toggles a pin when a step crosses the pinned line; the sidebar's
  // sections already keep pins apart, so it does nothing. One hook, overridden.
  landBefore() {}

  reorderStep(s, dir) {
    if (!s || !dir || !this.reorderIds) return;
    // Read the aim before stamping this step: aimedReorder asks how long ago the
    // LAST one was.
    const ids = this.aimedReorder();
    this.reorderStepAt = Date.now();
    const at = ids.indexOf(s.id);
    const target = at < 0 ? null : spaces().find((x) => x.id === ids[at + dir]) ?? null;
    // The end of the order: not a wrap, and nothing to say.
    if (!target) return;
    const step = this.landReorder(s, target, ids, dir);
    if (step) this.reorderAfter?.(s, step, ids.length);
  }

  stopReorder() {
    this.reorderHold?.cancel();
    this.reorderHold = null;
    this.reorderId = null;
    this.reorderDir = 0;
  }

  // Ctrl+J/K are the app's keys (the footer's dir commands), so a view with the
  // keyboard cannot see them. The footer hands the walk over through a shared
  // value; polled as fast as a key repeats, and only while the view holds the
  // keyboard.
  watchWalk(cx, on, channel) {
    this.walkTick?.cancel();
    this.walkTick = null;
    if (!on) return;
    let seen = shared(channel);
    this.walkTick = cx.timer.every(70, (cx) => {
      const m = shared(channel);
      if (!m || m === seen) return;
      seen = m;
      this.stopReorder();
      this.walk(String(m).startsWith("down") ? 1 : -1, cx);
    });
  }
}
