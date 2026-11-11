# Brutal Metrics

Herdr's default window with a brutalist cost panel on the right. It shows what
every Claude Code agent in the space has spent, in dollars and tokens, and how
full its context is. Each agent gets a pixel-art avatar. Working agents run a
rainbow border, and the panel turns rust and blinks when an agent needs you.
A Files browser shares the same panel.

![Brutal Metrics](preview.png)

## What you see

Left to right:

- **Sidebar, 268px** (`chrome` background, not resizable, min 44 / max 480):
  - Shipped `workspace-chrome` header, 46px. Window drag area.
  - Shipped `spaces` list and `agents-metrics` list, splitting the height 1:1
    (min 90px each).
  - `workspace-chrome` footer (`props.footer: true`), 69px.
- **Work column:**
  - **Tab bar, 42px** (`tabs-metrics`), a window drag area. It shows the tabs
    of the active space, with the agent's program icon and a spinner or dot for
    status. Next come a `+` button (opens the shipped `new-menu` popup),
    **Files** and **Metrics** toggles, and min/max/close buttons when the
    window draws its own.
  - **Body** (padding 8, gap 8):
    - The active tab's panes. Each pane has the shipped `pane` header (30px,
      always shown), a 1px `border` frame (1px `accent` when focused), radius
      10 and gap 8.
    - A hidden **side panel**, 368px (min 280, max 900). It is a stack of
      `files` (`files-metrics`) and `metrics` (`agent-metrics`).
  - **Status bar, 28px**: the shipped `workspace-status`.
- `titlebar: "none"`, terminal padding [14, 12], 1px `border` dividers,
  `canvas` background.

**Metrics panel (`agent-metrics`)** is set in JetBrains Mono, bold and black
weights, uppercase:

- **Hero card**: a 3px border, gray `#7a8076` background, ink `#0a1312` and
  edge `#95a7a7`. It shows `<SPACE> / COST`, the total estimated cost at 42px,
  then a row of three cells divided by 2px rules: AGENTS, TOKENS
  (input + output + cache write) and EST. USD (`ERR` if the collector failed).
  The last row shows the account the sessions run as: the login email and
  organization, or the credential kind (API KEY, BEDROCK, VERTEX...).
  With more than one account it shows `N CONTAS` and `email ×count` lines.
- **One card per agent** in the active space, with its sub-agents (terminals
  it started) indented 12px per level:
  - Left column (62px, or 48px for sub-agents): the pixel avatar, with the
    terminal address (`t13`) underneath.
  - Name in caps and a status stamp (`NEEDS YOU`, `WAITING n`, `WORKING`,
    `DONE`, `IDLE`).
  - A 24-segment context bar with three parts: base (the session's first
    turn: system prompt, tools, MCP) in `#7a8076`, conversation in `#b09270`
    (`#95553a` past 80%), and free space in `#1d1e19`.
  - A stats line: `ctx/window`, cache-hit `⚡%`, `~NT` turns left, and the age
    of the last turn. The agent's cost is on the right at 15px.
  - The current tool (`▸ Edit main.js`) while the agent is active.
  - A `/CLEAR` button.
  - When the space has more than one account, a `@ORG` tag marks agents not
    on the main one.

**Agents list (`agents-metrics`)** is the shipped agents list with the same
avatar (2px pixels) and a rainbow border on working rows.

## How it behaves

- **Statuses**: blocked shows as rust/`blocked`, `NEEDS YOU`, and blinks at
  650ms. waiting means a parent whose sub-agents are working or blocked; it
  shows as `accent`, `WAITING n`, and blinks at 1500ms. working is a solid
  `working` stamp. done and idle are outlined stamps. Idle avatars are
  dimmed to 60%.
- If any agent in the space is blocked, the hero card turns rust `#95553a`
  with a blinking `N NEEDS YOU` chip. If none is blocked but some are waiting,
  it shows `N WAITING` instead. The Metrics tab button also gets a blinking
  dot when an agent in the space is blocked.
- **Avatars**: a random symmetric 8x8 sprite and a body color from a
  10-swatch palette, fixed per terminal in shared state `agent.avatars`, so
  both mods draw the same one. While anything is active they cycle stand, hop
  and blink-step on a 200ms tick (blocked every tick, working every 2nd tick,
  waiting every 4th).
- **Rainbow border**: 7 flat colors, with alternate facets shaded to 72%,
  stepping one facet per tick around working cards and rows. It is an
  overlay, so it takes no clicks and doesn't change the card's size.
- Clicking the terminal address runs `agent.focus` (a sub-agent without a
  pane gets one). `/CLEAR` arms on the first click (`CONFIRM?`, 3s); a
  second click sends `/clear` to the agent with `hc send`.
- The metrics refresh every 5s.
- **Files / Metrics toggles** show or hide the panel and select its stack
  child. The choice is remembered per space (localStorage in
  `tabs-metrics`).
- **Tabs**: drag a tab onto another to reorder it, double-click to rename,
  right-click for the `menu` popup. The scroll wheel switches tabs.
- **Files**: a lazy tree of the focused pane's folder, with git status marks
  A/M/D/U and a read-only preview. Limits are 500 entries per folder and 5,000
  in total. For an agent started as `wsl.exe -d <distro> ... cd /path &&
  claude`, it browses that `/path` (from `hc get` argv) instead of the launch
  folder.

## Built from

- `layouts/brutal-metrics.json`, cloned from `main`. Nodes: `sidebar`
  (`brand`, `sidebar-lists` (`spaces`, `agents`), `sidebar-footer`) and
  `work` (`tabs`, `work-body` (`main` (tab: active), `panel` →
  `panel-body` stack (`files`, `metrics`)), `status`).
- Mods in this repo:
  - `agent-metrics`: the metrics panel, plus `avatar.js` and `collect.py`.
  - `agents-metrics`: a clone of `agents` with avatars and the rainbow
    border. It has a copy of `avatar.js`.
  - `files-metrics`: a clone of `files` that adds the WSL project-root rule.
  - `tabs-metrics`: a clone of `tabs` that adds the Files/Metrics panel
    toggles.
- Shipped mods it uses: `workspace-chrome` (header, footer and icons such as
  `clock`, `layers`, `chevron-*`, `pin`, `spinner`), `spaces`, `pane`
  (header and `close.svg`), `workspace-status`, `files` (`file.svg`),
  `new-menu` and `menu`.
- `herdr` API: `agents`, `terminals`, `panes`, `spaces`, `focused`, `run`
  (`agent.focus`, `pane.focus`, `terminal.pin`, `terminal.peek`,
  `layout.show/hide/select/resize`, `tab.*`, `window.*`), `hc` (`get`,
  `send`), `exec`, `readTextFile`, `watchFolder`, `shared`/`setShared`,
  `setAgentOrder` and `openOverlay`.
- **Data**: `collect.py` (Python 3, read-only on `~/.claude`). It reads each
  live Claude Code session in `~/.claude/sessions/<pid>.json` and adds up
  `usage` from its transcript `~/.claude/projects/<cwd>/<sessionId>.jsonl`,
  reading only the new bytes each time. Offsets are cached in
  `~/.cache/herdr-metrics.json`. The account comes from the process
  environment or settings `env` (credential kind only, never the token), or
  from `oauthAccount` in `~/.claude.json`. It prints JSON.
  - On Windows the mod runs it as
    `wsl.exe -d Ubuntu python3 <appHome>/mods/agent-metrics/collect.py
    <home>/.claude`. Windows paths are mapped to `/mnt/c/...`, so both WSL
    and Windows Claude Code sessions are read.
  - Elsewhere it runs `python3 collect.py ~/.claude`.
- **Session ↔ terminal matching**:
  1. Same title: the terminal title against the session's `ai-title` or
     `/rename`.
  2. Otherwise, the session that started within 60s of the terminal's
     `created_ms`.
  3. Otherwise, the newest session in the same cwd.
- **Cost**: estimated from `PRICES` in USD per million tokens (input,
  output, cache read, cache write). Opus is 15/75/1.5/18.75, Haiku
  1/5/0.1/1.25, and everything else 3/15/0.3/3.75. The context window is
  inferred: 1M if the context is over 200k, otherwise 200k.

## Watch out

- `DISTRO = "Ubuntu"` is hard-coded in `agent-metrics/main.js`; change it
  for another distro. The collector needs `python3` in that distro (or on
  the PATH outside Windows).
- Costs are estimates from a fixed price table, not your bill. Edit
  `PRICES` to match your models and plan.
- Only Claude Code agents get metrics. Other agents show `NO DATA`.
- The account row shows the login email of each session. Mind it in
  screenshots.
- `avatar.js` is duplicated in `agent-metrics` and `agents-metrics`,
  because a mod can't import outside its folder. Keep the copies in sync.
- `agents-metrics` and `tabs-metrics` load icons from the shipped
  `workspace-chrome`, `files` and `pane` folders. Those must exist.
- The side panel starts hidden. Open it with the Files or Metrics tab
  button.

## Done when

- `herdr-app check` passes for all four mods, and `layout.switch
  brutal-metrics` leaves `herdr-app status` with no errors.
- Clicking **Metrics** opens the 368px panel. In a space running Claude Code,
  the hero card shows a nonzero `$` and token total, and each agent card
  shows a filled context bar with `ctx/window`.
- A Claude Code agent asking for permission turns the hero card rust with a
  blinking `1 NEEDS YOU`, and the Metrics button shows a blinking dot.
- A working agent's card and its row in the sidebar get the moving rainbow
  border, and its avatar hops. The avatar is the same in both places.
- Clicking `/CLEAR` once shows `CONFIRM?`. A second click within 3s clears
  that agent's context.
- **Files** shows the focused pane's folder with git marks, and clicking a
  file previews it read-only.
