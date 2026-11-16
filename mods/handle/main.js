// A tab at the window's edge while the sidebar is fully hidden: click to bring
// it back at the width it had. icons shows the one on the sidebar's side.
//
// The layout keys that move panes, flip the sidebar, open a worktree and close
// a pane or tab live here too. The footer and the terminals list used to own
// them, and both are hidden with the sidebar and again when the rail folds.
// A command reaches shown copies only, so those keys died in both states. The
// two floating copies stay in the layout either way. Only the left one listens:
// both would step twice.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, run, layout, shared, setShared, placement, nextCommand, spaces, panes, focused, openOverlay } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

const wash = (c, a = "14") => (/^#[0-9a-fA-F]{6}$/.test(c ?? "") ? c + a : c);

// placement() is empty while a copy is still being seated, and during
// `herdr-app check`. A throw there must not take the mod down.
function edgeOf() {
  try { return placement()?.edge ?? null; }
  catch { return null; }
}

// Swap the sidebar with the work column, and the panel with the terminal pane.
function flipLayout() {
  const tree = JSON.parse(JSON.stringify(layout() ?? {}));
  if (!Array.isArray(tree.children) || tree.children.length < 2) return;
  tree.children.reverse();
  const body = find(tree, "work-body");
  if (body?.type === "row" && Array.isArray(body.children) && body.children.length > 1) body.children.reverse();
  const panel = find(tree, "panel");
  if (panel) {
    // A hidden panel's live width is its collapsed sliver; keep the real one.
    if (!panel.hidden && (panel.size?.px ?? 0) >= (panel.min ?? 0)) setShared("panel.width", panel.size.px);
    else if ((panel.size?.px ?? 0) < (panel.min ?? 0)) panel.size.px = shared("panel.width") ?? 368;
  }
  run("layout.set", { layout: tree });
}

function newWorktree() {
  const s = spaces().find((x) => x.active) ?? null;
  openOverlay({ mod: "worktrees", kind: "dialog", width: 460, height: 170, props: { space: s?.id, action: "new" } });
}

// Closing the last terminal of a space opens a fresh shell in that same
// space first, so Herdr never jumps to another space's terminal.
function closeFocused(name) {
  const f = focused();
  const tabId = f?.tab;
  if (!tabId) return;
  const space = spaces().find((s) => s.tabs.some((t) => t.id === tabId));
  if (!space) return;
  if (name === "close_pane" && f.pane && panes().filter((p) => p.tab === tabId).length > 1) return run("pane.close", { pane: f.pane });
  if (space.tabs.length > 1) return run("tab.close", { id: tabId });
  run("tab.new", { space: space.id });
  run("tab.close", { id: tabId });
}

export default class SidebarHandle extends View {
  init(_props, cx) {
    this.listening = false;
    this.arm(cx, 0);
  }

  // Wait until this copy knows its edge, then only the left one takes commands.
  arm(cx, tries) {
    if (this.listening) return;
    const edge = edgeOf();
    if (edge == null) {
      if (tries < 20) cx.timer.after(200, (cx) => this.arm(cx, tries + 1));
      return;
    }
    if (edge !== "left") return;
    this.listening = true;
    let moves = 0;
    cx.spawn(async () => {
      for (;;) {
        try {
          const c = await nextCommand();
          if (c === "dir_down" || c === "dir_up") {
            const direction = c === "dir_down" ? "down" : "up";
            // Ctrl+J/K is the app's binding, so the panel with the keyboard cannot
            // see it: it says so, and the walk comes back to it here. Same for
            // the find sheet.
            if (shared("search.open")) setShared("search.move", `${direction}:${++moves}`);
            else if (shared("sidebar.kb")) setShared("sidebar.move", `${direction}:${++moves}`);
            else run("pane.go", { direction });
          } else if (c === "flip_layout") flipLayout();
          else if (c === "worktree_new") newWorktree();
          else if (c === "close_pane" || c === "close_tab") closeFocused(c);
        } catch (e) {
          console.log(`handle: command failed: ${e}`);
        }
      }
    });
  }

  render() {
    const t = theme();
    const tree = layout();
    const side = find(tree, "sidebar");
    // Hidden nodes keep their size, so the width is still the sidebar's own.
    if (!side || !side.hidden) return div().size(0);
    const left = (tree?.children ?? [])[0]?.id === "sidebar";
    // One copy per edge; only the sidebar's own side draws the tab.
    const edge = edgeOf() ?? (left ? "left" : "right");
    if ((edge === "left") !== left) return div().size(0);
    const back = side.size?.px ?? shared("sidebar.width") ?? 223;
    return h_flex()
      .id(`handle-${edge}`)
      .w(24)
      .h(60)
      .rounded(10)
      .items_center()
      .justify_center()
      .bg(t.popover)
      .border_1()
      .border_color(wash(t.border, "aa"))
      .shadow_sm()
      .text_color(t.muted)
      .cursor_pointer()
      .tooltip("Show the sidebar")
      .hover((s) => s.bg(wash(t.accent, "14")).border_color(wash(t.accent, "66")).text_color(t.accent))
      .on_click(() => {
        // Older mods still read the flag. Showing the sidebar clears it.
        setShared("sidebar.collapsed", false);
        run("layout.show", { id: "sidebar" });
        run("layout.resize", { id: "sidebar", px: back });
      })
      .child(svg(`mods/workspace-chrome/${left ? "panel-left" : "panel-right"}.svg`).size(13));
  }
}
