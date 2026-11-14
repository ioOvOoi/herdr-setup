// One mod, two views.
//
// The sidebar (the layout's block) and the find sheet (Alt+F, an overlay) are
// the same logic with two drawings. Herdr refuses imports outside a mod's own
// folder, so they live together here: core.js is the one copy of the rules, and
// this root only chooses which view a copy is.
import { View } from "gpui-kit";
import { props, shared, setShared } from "herdr";
import { Sidebar } from "./sidebar.js";
import { Palette } from "./palette.js";

export default class Workspace extends View {
  init(_initial, cx) {
    const p = props() ?? {};
    // A block with "sidebar": true is the panel. A menu and the sort menu are
    // the panel's own popups. Everything else — mod.open, Alt+F — is the sheet.
    this.mode = p.sidebar || p.menu || p.sortMenu ? "sidebar" : "palette";
    this.inner = cx.new(this.mode === "sidebar" ? Sidebar : Palette, p);
  }

  render() {
    return this.inner;
  }

  // A retained child does not get the host's close call, so the sheet's own flag
  // is cleared here: a copy that closes must not leave Ctrl+J/K routed to a sheet
  // that is no longer there.
  close() {
    if (this.mode === "palette" && shared("search.open")) setShared("search.open", false);
  }
}
