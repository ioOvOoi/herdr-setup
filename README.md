# Herdr Setup

A keyboard-driven [Herdr](https://herdr.dev) layout: one sidebar with every agent
and terminal, a search sheet, and no tab bar. Panes are cards, the footer drags
the window, and a narrow sidebar folds into a rail of icons.

![Herdr Setup](preview.png?v=2)

## What you get

- **A sidebar instead of a tab bar.** `AGENTS` above `TERMINALS` in one 268 px
  column, with a footer on the bottom edge. Agents are grouped by what they need
  (Needs you → Done → Working → Idle); the sort button also offers *Grouped by
  space* and *Spaces with agents*. Terminals show their program's mark, tab and
  status. Pins, sub-agents and multiple machines are handled in place.
- **One search sheet, `Alt+F`.** Pinned places, spaces, worktrees and agents in
  one tree. Typing matches names, branches, folders, titles and states at once —
  `web hotfix` finds a space and its worktree, `needs you` finds what is waiting.
  `↑`/`↓` move, `Enter` goes, `Ctrl+P` pins, `Ctrl+R` renames, `Ctrl+D` closes.
- **A footer you can grab.** Machine on the left (opens Settings → Machines),
  shortcut sheet and settings on the right; the strip itself drags the window.
- **Panes as cards** — 10 px radius, 8 px between them, an accent border on the
  focused pane, and no header eating space.
- **Worktrees from the sidebar.** New, open and remove in dialogs. A pinned
  space never closes (its worktrees still can), and stopping an agent leaves a
  shell in its place. The sidebar keeps the keyboard through its dialogs, and a
  removal is optimistic: the checkout leaves the list on the press while git
  works behind it, and only a failure brings it back, with the reason.
- **A rail when narrow.** Below 160 px the sidebar becomes a column of state
  dots and icons; past nine spaces an ellipsis expands it again.
- **A searchable keys sheet** — every shortcut in one list, one row per command.

## Requirements

- Herdr **0.1.15**.
- `git` for the worktree dialogs. Nothing reaches the network.
- Optional: the `omarchy` theme (see [Theme](#theme)).

## Install

```sh
git clone https://github.com/tahadx/herdr-setup.git
cd herdr-setup
./install.sh
herdr-app do layout.switch --name workspace
```

`install.sh` copies the layout, its nine mods and its theme into
`~/.config/herdr-app`, and merges the layout's keys into `keys.json` (the old
file is kept as `keys.json.bak.<time>`). It touches nothing else. Set
`HERDR_APP_HOME` to install elsewhere.

To install by hand, copy `layouts/workspace.json` and `layouts/workspace.svg`
into `layouts/`, the nine mod folders listed below into `mods/`, and
`themes/omarchy.json` into `themes/`, then merge the `layout:workspace` section
of this repository's `keys.json` into yours.

## Keys

`keys.json` is the file: Herdr's own keys, this layout's section
(`layout:workspace`) and the terminal's. `install.sh` merges this layout's
section into yours and keeps everything else. Herdr's other layouts keep
`Ctrl+J`/`Ctrl+K` for themselves.

Every binding, with what it does, is in
[docs/bindings.md](docs/bindings.md) — the page is checked against `keys.json`,
so the two cannot drift.

`Ctrl+Shift+B` (Herdr's own key) still toggles the sidebar. With it hidden, a
small tab floats at the window edge to bring it back. `Alt+B` puts the keyboard
in the sidebar, and `Alt+Shift+N`, `Alt+W`, `Alt+Shift+W`, `Alt+Shift+R` and
`Alt+Shift+Q` run its space and worktree actions from anywhere in the layout.

Inside the sidebar the keys are the find sheet's own: `Ctrl+J`/`Ctrl+K` walk
(arrows too), `Enter` goes there, `Ctrl+D` closes the space, stops the agent or
removes the worktree, `Ctrl+P` pins, `Ctrl+R` renames, `Ctrl+A` starts a
worktree, `Ctrl+Shift+J`/`Ctrl+Shift+K` move the space a row (held, they keep
moving), and `Esc` leaves. `N`, `G` and `F` remain for a new space, opening a
worktree and folding. They are listed in the keys sheet (the keyboard icon in
the footer) and in [docs/bindings.md](docs/bindings.md). Making or closing a
space from the list keeps the keyboard in the list, so adding a space does not
start typing in its terminal.

## Repository layout

```
layouts/workspace.json    the window
layouts/workspace.svg     its drawn picture (also the settings thumbnail)
preview.png               a screenshot of the layout
mods/<name>/              main.js, mod.json, and the icons that mod draws
themes/omarchy.json       the palette this layout is drawn for
keys.json                 a working example key file
docs/bindings.md          every binding, and that file, ready to copy
tests/                    plain node, no Herdr needed
install.sh                copies it all into a Herdr home, merging keys
RECIPE.md                 the brief to rebuild this layout from scratch
```

Herdr's own mods live in the same folder but are not part of this repository;
`.gitignore` also keeps live state (`shared.json`, `view.json`, `data/`, the
socket) out of it.

## Mods

The layout ships nine mods as parts of itself, not separate downloads:

| Mod | What it is |
|---|---|
| `agents-list` | The sidebar: spaces, worktrees, the AGENTS list, pins, sort; and the `Alt+F` find sheet, which is the same logic drawn as a sheet (`core.js` is shared). |
| `terminals-list` | The TERMINALS list for the active space, plus Files / Changes / new terminal. |
| `footer` | The footer strip; `Ctrl+J`/`Ctrl+K`, layout flip, new worktree, closing dead spaces. |
| `icons` | Icons shared by the other mods, and an optional top bar. |
| `shortcuts` | The searchable shortcut sheet. |
| `worktrees` | New / open / remove worktree dialogs and stop confirmations. |
| `sidebar-menu` | Right-click the sidebar: move it to the other side, or hide it. |
| `handle` | The floating tab at the window edge while the sidebar is hidden. |
| `pane-header` | An optional pane header. **Unused by this layout.** |

Each folder is self-contained and can be copied into another Herdr home. The
sidebar and its `Alt+F` find sheet are one mod (`agents-list`): Herdr only lets a
mod import its own folder, so the logic they share lives in `core.js`, the two
drawings in `sidebar.js` and `palette.js`. `agents-list`, `terminals-list` and
`footer` also open dialogs from `worktrees`, so take that with them. Some icons are borrowed
from Herdr's own mod folders (`workspace-chrome`, `files`, `changes`, `pane`,
`tabs`) and are referenced, never copied.

## Checks

Load each mod after any edit:

```sh
herdr-app check mods/agents-list   # once per mod
```

The tests run the mods' own functions with stubs, so no Herdr is needed:

```sh
for t in tests/*.test.mjs; do node "$t"; done
```

GitHub Actions runs the same set plus a scratch install.

## Theme

`themes/omarchy.json` is the palette this layout is drawn for: background
`#0c0b0c`, foreground `#c1c1c1`, accent `#8a9a7b`. The layout names it for both
appearances, so it looks the same in light and dark.

On Omarchy, `omarchy-theme-set-herdr-app` rewrites this file from the current
theme. Any other theme works too: point the layout's `theme` at a name in
`themes/`, or remove it and let `settings.json` decide.

## How it is put together

The root is two columns: a fixed 268 px `sidebar` and the `work` column. Inside
the sidebar, `agents` and `terminals` share the height by weight over a 32 px
`sidebar-footer`. The work column shows the active tab as cards, with a hidden
368 px `files`/`changes` panel. Two `handle` blocks float on the side edges.

The ids matter: mods find their places by id (`sidebar`, `agents`, `terminals`,
`sidebar-footer`, `main`, `panel`, `panel-body`, `work-body`), so renaming a node
breaks the panels. `RECIPE.md` lists them and everything else a rebuild needs.

## Publishing

This is a layout bundle, listed at herdr.dev/layouts by its `herdr-layout` topic.
`preview.png` is a screenshot; `layouts/workspace.svg` is the drawn thumbnail.
To re-render it:

```sh
rsvg-convert -w 1416 -h 760 layouts/workspace.svg -o layouts/workspace.png
```

## Licence

MIT — see [LICENSE](LICENSE).
