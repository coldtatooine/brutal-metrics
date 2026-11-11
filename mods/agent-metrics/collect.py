#!/usr/bin/env python3
"""Claude Code usage collector for the agent-metrics Herdr mod.

Runs inside WSL. Prints one JSON object: one entry per live Claude Code
session (~/.claude/sessions/<pid>.json), with token totals read incrementally
from its transcript (~/.claude/projects/<cwd>/<sessionId>.jsonl).
Read-only on ~/.claude; keeps its own offsets in ~/.cache/herdr-metrics.json.
"""
import json, os, glob, re, sys, time

HOME = os.path.expanduser("~")
CLAUDE = os.path.join(HOME, ".claude")
CACHE = os.path.join(HOME, ".cache", "herdr-metrics.json")


def load_cache():
    try:
        with open(CACHE) as f:
            return json.load(f)
    except Exception:
        return {}


def save_cache(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(c, f)
    os.replace(tmp, CACHE)


def pid_alive(pid):
    return os.path.exists(f"/proc/{pid}")


def transcript_path(root, cwd, sid):
    # Claude Code names the folder after the cwd with separators and dots replaced by -
    enc = "".join("-" if ch in r"/\.:" else ch for ch in cwd)
    p = os.path.join(root, "projects", enc, sid + ".jsonl")
    if os.path.exists(p):
        return p
    hits = glob.glob(os.path.join(root, "projects", "*", sid + ".jsonl"))
    return hits[0] if hits else None


def zero():
    return {"off": 0, "in": 0, "out": 0, "cr": 0, "cw": 0, "turns": 0, "tools": 0,
            "model": None, "ctx": 0, "last_id": None, "last": None, "cost_by_model": {},
            "base": 0, "hist": [], "tool": None, "title": None, "custom": None,
            "turn": {"in": 0, "out": 0, "cr": 0, "cw": 0, "by": {}}, "v": 4}


def add(st, u, model, sign):
    i, o = u.get("input_tokens", 0), u.get("output_tokens", 0)
    cr, cw = u.get("cache_read_input_tokens", 0), u.get("cache_creation_input_tokens", 0)
    st["in"] += sign * i; st["out"] += sign * o; st["cr"] += sign * cr; st["cw"] += sign * cw
    m = st["cost_by_model"].setdefault(model or "?", [0, 0, 0, 0])
    m[0] += sign * i; m[1] += sign * o; m[2] += sign * cr; m[3] += sign * cw
    # the current turn: everything since the person's last prompt
    t = st["turn"]
    t["in"] += sign * i; t["out"] += sign * o; t["cr"] += sign * cr; t["cw"] += sign * cw
    m = t["by"].setdefault(model or "?", [0, 0, 0, 0])
    m[0] += sign * i; m[1] += sign * o; m[2] += sign * cr; m[3] += sign * cw


def is_prompt(d):
    """A line the person typed (not a tool result, a meta line, a compact summary or command output)."""
    if d.get("type") != "user" or d.get("isMeta") or d.get("isSidechain") or d.get("isCompactSummary"):
        return False
    c = (d.get("message") or {}).get("content")
    if isinstance(c, str):
        return not c.startswith("<local-command-")
    return isinstance(c, list) and any(isinstance(x, dict) and x.get("type") in ("text", "image") for x in c)


def tool_label(c):
    """A short 'Edit main.js' / 'Bash npm test' for a tool_use block."""
    name, inp = c.get("name") or "tool", c.get("input") or {}
    target = inp.get("file_path") or inp.get("path") or inp.get("notebook_path")
    if target:
        target = str(target).replace("\\", "/").rstrip("/").split("/")[-1]
    elif name == "Bash":
        target = " ".join(str(inp.get("command", "")).split())[:40]
    else:
        target = str(inp.get("pattern") or inp.get("query") or inp.get("description") or inp.get("url") or inp.get("subagent_type") or "")[:40]
    return (name + " " + target).strip()


def scan(path, st):
    # v4 adds the per-turn usage; v3 added the session title: an older cache never saw those lines, so read the transcript again.
    if st.get("v") != 4:
        acct = st.get("account")
        st.clear(); st.update(zero())
        if acct:
            st["account"] = acct
    for k, v in zero().items():
        st.setdefault(k, v)
    size = os.path.getsize(path)
    if size < st["off"]:
        st.clear(); st.update(zero())
    with open(path, "rb") as f:
        f.seek(st["off"])
        data = f.read()
    # only consume whole lines
    end = data.rfind(b"\n")
    if end < 0:
        return
    st["off"] += end + 1
    for line in data[: end + 1].split(b"\n"):
        # Session title: Claude Code's own (ai-title) or the person's /rename (custom-title). It is also the
        # terminal title Herdr shows, which is how the mod pairs a terminal with its session.
        if b'"aiTitle"' in line or b'"customTitle"' in line:
            try:
                d = json.loads(line)
                if d.get("type") == "ai-title" and d.get("aiTitle"):
                    st["title"] = d["aiTitle"]
                elif d.get("type") == "custom-title" and d.get("customTitle"):
                    st["custom"] = d["customTitle"]
            except Exception:
                pass
            continue
        user = b'"type":"user"' in line and b'"tool_result"' not in line
        if not user and b'"usage"' not in line and b'"tool_use"' not in line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        if user:
            if is_prompt(d):  # a new turn starts: its usage is counted from zero
                st["turn"] = {"in": 0, "out": 0, "cr": 0, "cw": 0, "by": {}}
            continue
        msg = d.get("message")
        if d.get("type") != "assistant" or not isinstance(msg, dict):
            continue
        u, mid, model = msg.get("usage"), msg.get("id"), msg.get("model")
        for c in msg.get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use":
                st["tools"] += 1
                st["tool"] = tool_label(c)
        if not isinstance(u, dict) or not model or model == "<synthetic>":
            continue
        if mid and mid == st["last_id"] and st["last"]:
            add(st, st["last"][0], st["last"][1], -1)  # same message streamed again: replace
        else:
            st["turns"] += 1
        add(st, u, model, 1)
        st["last_id"], st["last"], st["model"] = mid, [u, model], model
        st["ctx"] = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        if not st["base"]:
            st["base"] = st["ctx"]  # first turn: system prompt, tools, rules, skills, MCP
        if mid and mid == st.get("hist_id") and st["hist"]:
            st["hist"][-1] = st["ctx"]
        else:
            st["hist"] = (st["hist"] + [st["ctx"]])[-24:]
        st["hist_id"] = mid


# ---- account resolution -------------------------------------------------------------------------
# Which Claude identity a session runs as. Only email/org/kind leave this function; tokens never do.
CRED_ENV = {"ANTHROPIC_API_KEY": "API KEY", "ANTHROPIC_AUTH_TOKEN": "API KEY", "CLAUDE_CODE_OAUTH_TOKEN": "OAUTH TOKEN",
            "CLAUDE_CODE_USE_BEDROCK": "BEDROCK", "CLAUDE_CODE_USE_VERTEX": "VERTEX", "CLAUDE_CODE_USE_FOUNDRY": "FOUNDRY"}


def proc_env(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            return dict(kv.split("=", 1) for kv in f.read().decode("utf-8", "ignore").split(chr(0)) if "=" in kv)
    except Exception:
        return None


def posix_path(p):
    # A Windows path (drive or wsl.localhost UNC form) as WSL sees it.
    u = p.replace("\\", "/")
    m = re.match(r"^//wsl[.$]localhost/[^/]+(/.*)$", u, re.I)
    if m:
        return m.group(1)
    m = re.match(r"^([A-Za-z]):/(.*)$", u)
    return f"/mnt/{m.group(1).lower()}/{m.group(2)}" if m else u


def settings_env(path):
    try:
        with open(path, encoding="utf-8") as f:
            e = json.load(f).get("env")
        return e if isinstance(e, dict) else {}
    except Exception:
        return {}


_json_memo = {}


def read_json(path):
    # One parse per file per run: ~/.claude.json is large and every session reads it.
    if path not in _json_memo:
        try:
            with open(path, encoding="utf-8") as f:
                o = json.load(f)
            _json_memo[path] = o if isinstance(o, dict) else {}
        except Exception:
            _json_memo[path] = {}
    return _json_memo[path]


def mcp_names(d):
    # A plugin's .mcp.json is either {"mcpServers": {...}} or the server map itself.
    m = d.get("mcpServers", d)
    return [k for k, v in m.items() if isinstance(v, dict)] if isinstance(m, dict) else []


def hook_keys(src, hooks):
    # settings and plugin hooks: {event: [{"matcher": ..., "hooks": [{"type": ..., "command": ...}]}]}; one key per handler.
    out = []
    if isinstance(hooks, dict):
        for ev, groups in hooks.items():
            for i, g in enumerate(groups if isinstance(groups, list) else []):
                for j, _ in enumerate(g.get("hooks", []) if isinstance(g, dict) else []):
                    out.append(f"{src}|{ev}|{i}|{j}")
    return out


def config_of(native, root, cwd):
    """What the session's folder has configured: MCP servers, hook handlers, enabled plugins.

    Read from files only, so it is what is configured, not what is connected (claude.ai connectors
    live in the cloud and are not counted). Plugin MCP servers and hooks are read from their install
    folder, which only works for a native root (installPath is an OS path of the same machine)."""
    cwd_p = posix_path(cwd)
    home_root = os.path.dirname(root.rstrip("/"))
    settings = [os.path.join(root, "settings.json"), os.path.join(root, "settings.local.json")] + \
               [os.path.join(cwd_p, ".claude", n) for n in ("settings.json", "settings.local.json")]
    plugins, hooks = {}, []
    for sp in settings:
        d = read_json(sp)
        for k, v in (d.get("enabledPlugins") or {}).items():
            plugins[k] = bool(v)  # later files override earlier ones
        hooks += hook_keys(sp, d.get("hooks"))
    on = sorted(k for k, v in plugins.items() if v)
    mcp = set()
    cj = read_json(os.path.join(home_root, ".claude.json"))
    mcp.update((cj.get("mcpServers") or {}).keys())
    proj = (cj.get("projects") or {}).get(cwd_p) or {}
    mcp.update((proj.get("mcpServers") or {}).keys())
    mcp.update(mcp_names(read_json(os.path.join(cwd_p, ".mcp.json"))))
    if native:
        inst = (read_json(os.path.join(root, "plugins", "installed_plugins.json")).get("plugins")) or {}
        for name in on:
            entries = inst.get(name) or []
            path = (next((e for e in entries if e.get("scope") == "user"), entries[0] if entries else None) or {}).get("installPath")
            if not path:
                continue
            mcp.update(f"{name.split('@')[0]}:{m}" for m in mcp_names(read_json(os.path.join(path, ".mcp.json"))))
            hooks += hook_keys(name, (read_json(os.path.join(path, "hooks", "hooks.json"))).get("hooks"))
    mcp -= set(proj.get("disabledMcpServers") or [])
    return {"mcp": sorted(mcp), "hooks": sorted(set(hooks)), "plugins": on}


def account_of(native, root, pid, cwd):
    env = (proc_env(pid) if native else None) or {}
    cfg_dir = env.get("CLAUDE_CONFIG_DIR") if native else None
    merged = dict(env)
    # env set in settings files reaches the agent too: user settings, then the project's
    for p in [os.path.join(cfg_dir or root, "settings.json")] + [os.path.join(posix_path(cwd), ".claude", n) for n in ("settings.json", "settings.local.json")]:
        merged.update({k: str(v) for k, v in settings_env(p).items()})
    for key, label in CRED_ENV.items():
        if merged.get(key):
            return {"kind": "env", "label": label, "email": None, "org": None, "source": key}
    # The global config sits next to the config dir (~/.claude.json), or inside CLAUDE_CONFIG_DIR.
    home_root = os.path.dirname(root.rstrip("/"))
    candidates = [os.path.join(cfg_dir, ".claude.json")] if cfg_dir else [os.path.join(home_root, ".claude.json"), os.path.join(root, ".claude.json")]
    for c in candidates:
        try:
            with open(c, encoding="utf-8") as f:
                o = json.load(f).get("oauthAccount") or {}
        except Exception:
            continue
        if o.get("emailAddress"):
            return {"kind": "login", "label": None, "email": o["emailAddress"], "org": o.get("organizationName"),
                    "source": c, "approx": not native}
    return None


def main():
    cache = load_cache()
    out = []
    # Native root (this WSL's ~/.claude) plus any extra roots given as arguments
    # (e.g. /mnt/c/Users/<you>/.claude for Claude Code running on Windows).
    roots = [(CLAUDE, True)] + [(r, False) for r in sys.argv[1:] if os.path.isdir(r)]
    entries = [(root, native, p) for root, native in roots for p in glob.glob(os.path.join(root, "sessions", "*.json"))]
    for root, native, p in entries:
        try:
            with open(p) as f:
                s = json.load(f)
        except Exception:
            continue
        pid, sid, cwd = s.get("pid"), s.get("sessionId"), s.get("cwd")
        if not (pid and sid and cwd):
            continue
        if native and not pid_alive(pid):
            continue  # other roots' pids live in another OS: judged by transcript age below
        tp = transcript_path(root, cwd, sid)
        if not native and (not tp or time.time() - os.path.getmtime(tp) > 2 * 86400):
            continue
        st = cache.setdefault(sid, zero())
        mtime = None
        if tp:
            try:
                scan(tp, st)
                mtime = int(os.path.getmtime(tp) * 1000)
            except Exception as e:
                print(f"scan {sid}: {e}", file=sys.stderr)
        # Pinned on first sight: a later /login must not relabel a session that is already running.
        if not st.get("account"):
            st["account"] = account_of(native, root, pid, cwd)
        out.append({"pid": pid, "account": st.get("account"), "session": sid, "cwd": cwd, "started": s.get("startedAt"),
                    "mtime": mtime, "in": st["in"], "out": st["out"], "cache_read": st["cr"],
                    "cache_write": st["cw"], "turn": st["turn"], "turns": st["turns"], "tools": st["tools"],
                    "model": st["model"], "ctx": st["ctx"], "base": st["base"], "hist": st["hist"], "tool": st["tool"], "by_model": st["cost_by_model"],
                    "title": st.get("custom") or st.get("title"), "config": config_of(native, root, cwd)})
    # forget sessions that are gone
    live = {o["session"] for o in out}
    for k in list(cache):
        if k not in live:
            del cache[k]
    save_cache(cache)
    print(json.dumps({"now": int(time.time() * 1000), "sessions": out}))


main()
