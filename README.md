# Brutal Metrics

A [Herdr](https://herdr.dev) layout with a brutalist cost panel. It shows
what each Claude Code or Codex agent in a space spends in dollars (Claude) or
plan use (Codex) and tokens, and how full its context window is.

![Brutal Metrics](preview.png)

## Features

- **Summary box** at the top of the panel, in compact cells (value over label):
  - the estimated cost of the space, with **LAST TURN** and **TOTAL COST** tabs, and the account each session
    runs as;
  - `AGENTS`, `TOKENS` and `CACHE` (cache reads as a share of all input
    tokens), all summed over the space;
  - `CTX MAX`, the fullest context window among the agents (tinted from 80%);
  - `PLUGINS`, `MCP` and `HOOKS`, the configured items across the agents.
- **One card per agent**, with sub-agents nested under it:
  - a `CLAUDE` or `CODEX` tag;
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
  how many messages it sent and received.
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

## What the numbers mean

- Two tabs at the top of the box switch the numbers: **LAST TURN** (the
  default) or **TOTAL COST**. They change the big cost, `TOKENS` and `CACHE`,
  and the cost and cache of every card.
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
- **Claude Code** or **Codex CLI**: other agents appear but show `NO DATA`.
  Codex is found next to Claude's folder (`~/.codex` beside `~/.claude`, on
  Windows or in WSL). Only threads started in the last 7 days and active in
  the last 2 are read.

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

- Costs are what the tokens would cost on the **Anthropic API at list
  price**, not what a Claude subscription bills you. They are token usage
  times the `PRICES` table in `mods/agent-metrics/main.js`, which has one row
  per model (id without its date suffix): input, output, cache read, and
  cache write with the 5-minute and the 1-hour TTL, priced apart. Claude Haiku
  5.5 requests whose prompt is over 100k tokens use its higher rate.
- A model missing from the table is priced as its family's current model
  (Opus, Sonnet, Haiku or Fable), and its cost shows with a `~`, as in `~$1.20`.
  Add a row to price it exactly.
- Codex on a ChatGPT plan has no per-token price. Its card shows the share of
  the plan's rate limit used instead of dollars, and it adds nothing to the
  dollar total.
- A terminal is paired only with a session of its own kind: Claude with
  Claude, Codex with Codex. The kind comes from what the agent reports to Herdr.
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
