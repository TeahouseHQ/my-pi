# Load-time part selection without project-trust checks

`my-pi` is a global extension that loads in every project, and projects can now
select which **parts** load via `<project>/.pi/my-pi.json` (an allow-list, e.g.
`{"parts": ["footer"]}`). We resolve the selection once, at extension load
(`process.cwd()`), and register only the selected parts — a disabled part's
`session_start` handlers never run and, for `subagent`, its tool is never
registered at all. Deliberately, we do **not** gate the read on
`ctx.isProjectTrusted()`, even though pi's extension docs recommend exactly that
before reading project-local config: load-time resolution happens before pi
resolves project trust, and deferring to a trust check would force activation
gating instead, which we rejected.

## Considered Options

**Activation gating** (rejected): register every part unconditionally and let a
shared config module no-op disabled parts per session, checked after trust
resolution. This honors the trust guidance and tracks per-session cwd, but a
disabled `subagent` stays registered (present-but-refusing, or needing
active-tools surgery to hide), and "load only the selected parts" becomes an
approximation. Load gating buys true absence semantics and a single uniform
rule for the cost of the trust check.

## Consequences

- Config from an untrusted project is honored. Accepted because the config file
  lives in the user's own project checkout on a personal machine; a hostile
  untrusted project could suppress UI parts or the subagent tool, not gain
  capabilities.
- The selection is fixed for the process lifetime, keyed to the launch cwd;
  later `/resume` or directory changes do not re-read it.
- The selection applies uniformly to every run mode (TUI, print, json, rpc) —
  in a footer-only project, headless `pi -p` runs there also have no subagent
  tool.
- A malformed/unreadable config never blocks startup: fall back to all parts
  and warn once via `ctx.notify` on the first `session_start` (the parse-time
  warning is stashed, since no context exists at load). Unknown part names are
  ignored with the same warning; valid ones are kept.
