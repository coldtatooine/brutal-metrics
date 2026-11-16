# Brutal Metrics

A [Herdr](https://herdr.dev) layout with a brutalist metrics panel. It shows
what each Claude Code, Codex or omp agent in a space is doing: tokens, cache, plan
use (Codex), and how full its context window is. No financial cost is shown.

![Brutal Metrics](preview.png)

## Features

- **Summary box** at the top of the panel, in compact cells (value over label):
  - the tokens of the space, with **SESSION**, **LAST TURN** and **COST** tabs, and the account each session
    runs as;
  - `AGENTS` and `CACHE` (cache reads as a share of all input
    tokens), all summed over the space;
  - `CTX MAX`, the fullest context window among the agents (tinted from 80%);
  - `PLUGINS`, `MCP` and `HOOKS`, the configured items across the agents.
- **One card per agent**, with sub-agents nested under it:
  - a `CLAUDE`, `CODEX` or `OMP` tag;
  - a thin 24-segment context bar split into base (system prompt, tools,
    MCP), conversation and free space;
  - the context size against the window size, the cache hit rate, an
    estimate of turns left, and the time since the last turn;
  - the tool the agent is running;
  - a `/COMPACT` button (one click) and a two-click `/CLEAR` button.
- **Alerts**: when an agent needs you, the panel turns rust and shows a
  blinking `NEEDS YOU`. A parent waiting on its sub-agents shows `WAITING`.
- **Pixel-art avatars**: each agent gets a random sprite, the same in the
  sidebar and in the panel. Active agents' avatars animate, and working agents
  get a moving rainbow border.
- **Flow tab**: a vertical flowchart of the messages the agents send each
  other with `hc send`. The orchestrator sits on top, linked to every agent;
  a pulse runs from sender to receiver on each message, and the route stays
  lit for a few seconds. Each node shows the status, the terminal code and
  how many messages it sent and received; rest the pointer on the counts for
  the last messages that node took part in. Only real sends are drawn: if the
  feed is missing, failed or stale the tab says so (with RETRY) instead of
  simulating traffic.
- **Files panel**: a lazy file tree of the focused pane's folder, with git
  status marks and a read-only preview.
- **Files**, **Metrics** and **Flow** buttons in the tab bar open the side panel. Each
  space remembers which one was open.

## Install

Paste this into your coding agent:

```
Read ~/.config/herdr-app/AGENTS.md, then add this layout: https://github.com/coldtatooine/brutal-metrics
```

To install it by hand:

1. Copy `layouts/brutal-metrics.json` to `~/.config/herdr-app/layouts/`.
2. Copy the five folders in `mods/` (`agent-metrics`, `agents-metrics`, `tabs-metrics`, `files-metrics`, `agent-flow`) to `~/.config/herdr-app/mods/`.
3. Switch to the layout with `ctrl-shift-l`, or run
   `herdr-app do layout.switch '{"name":"brutal-metrics"}'`.

Your own layout stays as it is. Press `ctrl-shift-l` to switch back.

## Scope, loading and errors

- A **play/pause** button beside the tabs cycles SESSION, LAST TURN and COST every 8 s; a click on a
  tab while it plays shows that tab for a full turn of the timer.
- A **SCOPE** row under the account names picks the agents shown, in both the Metrics and the Flow tabs (one shared switch, the Flow tab has its own row of buttons): **SPACE** (the shown space, the
  default), **PROJECT** (every agent, in any space, whose folder is the focused terminal's)
  or **ALL**.
- Nothing reads zero until the collector has answered once: the numbers show `…`, cards say
  `READING…`, and an empty list shows pulsing placeholders. If a read fails, the last data
  stays and a red bar says `STALE · READ FAILED: …` with a **RETRY** button; the next
  refresh (5 s) retries by itself.
- The side panel is remembered per space; a space that never had a choice starts with the
  last one made anywhere, instead of closed.

## Headline, hover cards and details

- A one-line **headline** tops the summary box: `READING…`, `READ FAILED`, `NO AGENTS`,
  `N WORKING` or `ALL IDLE`; the blinking `NEEDS YOU` and `WAITING` chips sit beside it.
- Rest the pointer on a figure for 250 ms for a **hover card**: the big figure lists tokens
  (or cost) by agent; `AGENTS` the state of each; `CACHE` and `CTX MAX` the figure per agent;
  `PLUGINS`, `MCP` and `HOOKS` the names.
- Click an agent's **name** (Metrics card or Flow node) for its **detail dialog**: model,
  account, folder, session, context and base, cache hit, turns left, session and last-turn
  tokens, turns, tool calls, last tool, start and last activity, and what is configured.
  Buttons: **ASK STATUS** (types a short status request into the agent), `/COMPACT`,
  **OPEN TERMINAL**, **CLOSE** (Esc too).

## What the numbers mean

- Two tabs at the top of the box switch the numbers: **SESSION** (the
  default) or **LAST TURN**. They change the big token count and `CACHE`,
  and the tokens and cache of every card.
  - Last turn is everything since your last prompt, including the model calls
    and tool loops it triggered. An idle agent keeps showing its last turn,
    and a new prompt starts the count from zero.
  - Total is the whole session.
- `CTX MAX` is the context size at the last turn.
- `PLUGINS`, `MCP` and `HOOKS` count what is configured, not what is
  connected. They are read from the settings files, `.claude.json`,
  `.mcp.json` and the enabled plugins. claude.ai cloud connectors are not
  counted.

## Requirements

- **Python 3**: the metrics come from `mods/agent-metrics/collect.py`.
  - On Windows it runs inside WSL. The distro is set by
    `DISTRO = "Ubuntu"` in `mods/agent-metrics/main.js`, so edit that if
    yours has another name.
  - On other systems it runs with `python3`.
- **Claude Code**, **Codex CLI** or **[omp](https://github.com/can1357/oh-my-pi)**: other agents appear but show `NO DATA`.
  Codex is found next to Claude's folder (`~/.codex` beside `~/.claude`, on
  Windows or in WSL). Only threads started in the last 7 days and active in
  the last 2 are read. omp agents are the running `omp` processes of the
  machine, each with the session file it holds open (or, failing that, the one
  its terminal's `terminal-sessions` entry names).
- **Other machines**: for each machine whose spaces are open (`hc machine add`),
  the mod runs `collect.py` there through herdr-core and keeps its sessions
  apart. That machine needs `python3`; nothing is installed on it, the script
  is sent each time. It reads that machine's own `~/.claude`, `~/.codex` and
  `~/.omp`. Only omp on a remote machine has been tried; Claude Code and Codex
  there use the same code but are untested. The message events for the Flow tab
  still come from this computer only.

## What it reads and runs

- `collect.py` only reads Claude Code's files:
  - `~/.claude/sessions/*.json` and the session transcripts;
  - `settings.json`, `settings.local.json`, `.mcp.json` and the enabled
    plugins' `hooks/hooks.json` and `.mcp.json`, to count plugins, MCP
    servers and hooks;
  - `~/.claude.json` or settings `env`, for the account (email, org or
    credential kind, never a token).
- It also reads these Codex files, without changing them:
  - the rollouts in `~/.codex/sessions/YYYY/MM/DD/`, for the folder, model,
    context window, token totals, the last request's usage, the tool in use
    and the plan's rate-limit use;
  - `session_index.jsonl` for thread names, and `config.toml` and
    `hooks.json` to count plugins, MCP servers and hooks. It never reads
    `auth.json`. The account shown is the plan type from the rollout.
- It reads these omp files, without changing them:
  - the session files `~/.omp/agent/sessions/<folder>/*.jsonl`, for the
    folder, title, model, token totals (input, output, cache read and write),
    the tool in use and what omp itself says each request cost;
  - `~/.omp/agent/models.db` (read-only), for a model's context window, and
    the file names in `~/.omp/agent/extensions/` and a folder's `.mcp.json`,
    to count plugins and MCP servers. omp's hooks are not read, so HOOKS
    shows 0 for omp. Nothing under `~/.omp` with credentials is opened.

  From the same transcripts and rollouts it also picks up the messages agents send each
  other with `hc send`. Each one arrives as a line starting with
  `<hc from="tN">`, either as a prompt or absorbed into a running turn. The last
  50 come out as `events`: `id`, `seq`, `ts`, `from` (the sender's hc
  address), `from_name`, `to_session` (the receiver's session; the mod maps it
  to a terminal as `to`), `kind` (`send`) and a one-line `summary` of at most
  60 characters. The full text of the messages is never kept. A `cursor` comes with them, and
  `collect.py --since <cursor>` prints only the events after it.

  It keeps read offsets and the last events in `~/.cache/herdr-metrics.json`
  (`HERDR_METRICS_CACHE` points it at another file, for tests). It makes no
  network requests.
- The mods run `hc get` and `hc send` (`/COMPACT` and `/CLEAR` send `/compact` and `/clear` to the
  agent). They also run `git status` and a folder listing for the Files
  panel.

## Notes

- Cost lives in its own **COST** tab, never in the other two. It is an estimate: what the
  session's tokens would cost on the Anthropic API at list price (the `PRICES` table in
  `mods/agent-metrics/main.js`), not what a subscription bills. A model missing from the
  table is priced as its family's current model and shows with a `~`. Tokens are input +
  output + cache writes. `node scripts/test-cost.mjs` checks the math.
- omp reports what each request cost with the provider it went through, so an omp
  card's COST figure is that, not the table's list price (which is Anthropic's and
  does not fit other providers' models), and it never shows a `~`.
- Codex on a ChatGPT plan: its card shows the share of the plan's rate limit used
  in place of the token figure.
- A terminal is paired only with a session of its own kind and machine: Claude with
  Claude, Codex with Codex, omp with omp. The kind comes from what the agent reports
  to Herdr. An omp terminal is paired first by its foreground process: omp's session
  names its own pid, and `hc get` reports the terminal's.
- The panel shows each session's login email. Keep that in mind before you
  share a screenshot.
- Message events only cover messages that reached a Claude Code or Codex agent
  and were written to its transcript or rollout. These are not seen: messages to other programs, sends that never arrived
  (an agent starting up or blocked), and text typed without an hc tag
  (including with `notes = false` in hc's config). A tag pasted by hand counts
  as a message. A message sent while the receiver is busy shows up when the
  receiver takes it in.

See [RECIPE.md](RECIPE.md) for the full spec, which an agent can use to
rebuild the layout from scratch.

## Tests

`node --test tests/model.test.mjs tests/flow.test.mjs` covers `mods/agent-metrics/model.js` (formatting,
window, cost, turns left, pairing terminals with sessions, the detail dialog's rows), `scope.js`, and the
Flow tab's `feed.js` and `flow.js` (feed state, replies, orchestrator, geometry); it also checks that the
copies of `avatar.js` and `scope.js` stay identical. `node scripts/test-cost.mjs` checks the cost
math against Claude Code's `/usage` and the collector's cache-write split. Check a mod with
`herdr-app check <mod folder>`; `node --check` misses QuickJS-only errors.
