# antigravity-telegram-watchdog

Supervised Telegram gateway for Google's Antigravity CLI (`agy`).
Chat with an Antigravity agent from your phone, kept alive across crashes
and machine resets. Proven end-to-end on a live VM trial.

Upstream bridge: [ardiannurcahya/antigravity-cli-telegram-bot](https://github.com/ardiannurcahya/antigravity-cli-telegram-bot) (`v0.6.0`, MIT).
This repo is the supervision layer around it: boot hook, watchdog,
headless workspace pattern, and the trial notes.

## How it fits together

```
daemon boot
  -> /workspace/hooks/init-agy.ts          # boot hook, same contract as init.ts
       -> /workspace/bin/agy-telegram-supervise   # watchdog (this repo)
            -> node dist/cli.js            # upstream gateway (agy-telegram)
                 -> agy binary             # Antigravity CLI, headless -p
```

| Piece | Source |
|-------|--------|
| `hooks/init.ts` | this repo — guarded detached spawn of the supervisor |
| `bin/agy-telegram-supervise` | this repo — probe loop, restart, backoff |
| `templates/.env.example` | this repo — sanitized config template |
| gateway code (`dist/`) | upstream repo, built from source |
| `agy` binary | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |

## Prerequisites

- Node 22+ (uses native SQLite)
- Google account eligible for Antigravity (the CLI enforces an eligibility
  check after sign-in; unverified accounts are rejected until verified)
- Telegram bot token from BotFather (a fresh bot, not shared with others)
- Numeric Telegram user IDs for the allowlist (usernames don't work)

## Setup

```bash
# 1. Antigravity CLI + auth (interactive Google sign-in)
export HOME=/data/agy-home PATH="/workspace/agy-trial/bin:$PATH"
agy   # opens a browser login; verify eligibility if prompted

# 2. Bridge (upstream) — build from source
git clone <upstream-url> agy-telegram
bun install && ./node_modules/.bin/tsc
./node_modules/.bin/tsx --test test/*.test.ts   # 191 passing at trial time

# 3. Config
cp templates/.env.example agy-telegram/.env
chmod 600 agy-telegram/.env
# fill TELEGRAM_BOT_TOKEN + TELEGRAM_ALLOWED_USER_IDS

# 4. Headless system prompt (optional but recommended)
# place your own workspace AGENTS.md at <AGY_WORKSPACE>/AGENTS.md

# 5. Supervision
cp bin/agy-telegram-supervise /workspace/bin/
cp hooks/init.ts /workspace/hooks/init-agy.ts
/workspace/bin/agy-telegram-supervise   # converges the gateway, then watches
```

Send the bot `/start`, then a small prompt first (e.g. `what is 2+2`).

## Auth detail (Google sign-in + eligibility)

```bash
export HOME=/data/agy-home PATH="/workspace/agy-trial/bin:$PATH"
agy   # prints a Google URL; approve in a browser
```

`HOME` matters: auth lands under `$HOME/.gemini/` as
`antigravity-cli/antigravity-oauth-token`, and headless runs read it from
there. Point every invocation (terminal, gateway, probes) at the same HOME
or auth silently disappears.

After sign-in the CLI runs an **eligibility check**. A fresh Google account
fails it:

```
error: Eligibility check failed: Your current account is not eligible for
Antigravity. Verify your account to continue.
```

Fix: open the verification URL the CLI prints (a
`accounts.google.com/signin/continue?...gemini-code-assist...` link, expires
fast, regenerate by re-running if stale), complete verification, success
page lists Gemini Code Assist, Cloud Code, Gemini CLI, and Antigravity as
authorized. Re-run the headless probe:

```bash
agy -p "Reply with exactly this string and nothing else: AGY-ONLINE"
# -> AGY-ONLINE
```

Headless `-p` runs auto-deny tool calls; add
`--dangerously-skip-permissions` for manual probes (the gateway sets the
equivalent itself).

Auth is portable: copying `$HOME/.gemini/.../antigravity-oauth-token` plus
`.config` to a fresh HOME preserves login with no memory carried over.

## Watchdog design

`bin/agy-telegram-supervise` mirrors `opencode-telegram-supervise`:

- pidfiles under `<root>/run/`, logs under `<root>/logs/`
- single-instance guard (second launch exits 0), stale pidfiles harmless
- health = gateway process alive (matched by cwd, not just filename —
  plain `dist/cli.js` matching once caused a kill-relaunch loop against an
  unrelated bridge) plus a Telegram `getMe` probe each interval
- adopts a manually started gateway instead of double-running it
- crash bursts back off 5 minutes (bad token, dead network)
- default interval 60s, override with `AGY_TELEGRAM_SUPERVISOR_INTERVAL`
- gateway launches with a clean agent HOME, updater disabled
  (`AGY_CLI_DISABLE_AUTO_UPDATE=true`), and the `.env` sourced

## Boot hook

`/workspace/hooks/init-agy.ts` has exactly the `init.ts` contract:
default-exported `init(ctx)`, guarded `existsSync` on the supervisor,
spawn detached + `unref`, pid logged. Inert until the supervisor exists.

## Trial lessons (read before debugging)

1. **Two doctrines load.** `agy` reads the workspace `AGENTS.md` AND any
   `AGENTS.md` found above it, plus its own built-in habits. A global
   instructions file shadowing the workspace silently wins overlapping
   topics (deploy rules cited the wrong file until isolated).
   Fix: put the agent workspace outside any ancestor holding another
   `AGENTS.md` (here: `/data/agy-workdir/default`, same persistent volume).
2. **Stale updater daemon.** `agy` self-updates and can leave a background
   process rooted at the install-time paths holding a deleted binary,
   serving stale context into headless runs. Kill it, set
   `AGY_CLI_DISABLE_AUTO_UPDATE=true`, verify with a probe question whose
   answer exists only in your file.
3. **Headless permissions.** Headless `-p` runs auto-deny tool calls.
   The gateway sets auto-approve; manual probes need
   `--dangerously-skip-permissions`.
4. **Favicon-style caching applies to bots too.** After config changes,
   restart the gateway; Telegram caches bot profiles client-side.
5. **Match processes by cwd, not filename.** Two bridges can run the same
   `dist/cli.js` filename. `/proc/<pid>/cwd` disambiguates.
6. **Never `pkill -f` with a pattern in your own command line.**
   The shell matches itself. Scan `/proc` from python (or similar) and
   exclude your own PID instead.

## Disk layout (VM)

- `/home` (root volume, roomy) does NOT survive machine resets here.
- `/workspace` + `/data` share one small persistent virtiofs volume.
  Keep 1G+ free or the VM crashes.
- Rule used: binaries and repos under `/workspace/agy-trial/`,
  agent home + workspace under `/data/`. Total trial footprint ~526M.

## Security notes

- `.env` is `chmod 600`, never committed. This repo carries templates only.
- Allowlist is numeric user IDs, private chats only by default.
- The gateway auto-approves tool permissions per its config; restrict the
  allowlist to trusted users and scope the workspace tightly.
- Tokens pasted into workspace `AGENTS.md` are sent to the model every run.
  That is the tradeoff of agent-usable credentials; rotate on suspicion.
