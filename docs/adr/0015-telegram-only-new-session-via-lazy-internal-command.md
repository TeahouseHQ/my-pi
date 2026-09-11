# Telegram-only `/new` via a lazily-registered internal pi command

`telegram-new-session` contributes a `/new` command to the paired Telegram
chat that starts a fresh pi session. The user requirement is that it be
Telegram-only: nothing may appear in the TUI's `/` command menu.

## Context

- pi grants `ctx.newSession()` **only** to pi-command handlers
  (`ExtensionCommandContext`); event, tool, and bridge contexts deliberately
  lack it, because session control is unsafe outside user-initiated commands.
- `pi.sendUserMessage("/cmd", { expandPromptTemplates: true })` is the
  documented way to dispatch a registered pi command programmatically; pi
  executes it immediately, even mid-turn (the handler can `waitForIdle()`).
- pi-telegram does not forward unknown Telegram slash commands to pi — they
  reach the model as literal text — so the command must also be claimed on the
  bridge side via its public `registerTelegramCommand` API.
- Any pi command whose name does not collide with a built-in is listed in the
  TUI autocomplete; there is no hide flag and no unregister API. (Colliding
  with the built-in `/new` would hijack it and emit a startup warning.)

## Decision

Register the internal pi command (`tg-new-session`) **lazily, one dispatch at
a time**: the Telegram `/new` handler registers it and immediately forwards
`/tg-new-session` into pi with `expandPromptTemplates: true`. The command
therefore only ever exists inside a session in which `/new` was actually used
from Telegram, and the TUI autocomplete provider — built at startup and
session rebinding, never on command registration — never lists it in a fresh
session. A successful `newSession()` reloads extensions, discarding the
registration with the old session.

The bridge side uses pi-telegram's public membranes only (`/commands`,
`/delivery`). Their registries are `globalThis`-scoped, so this repo and the
installed bridge resolve as separate module copies yet still interoperate.

## Considered Options

**Permanent internal command** (rejected): always visible in the TUI `/` menu,
violating the requirement.

**Shadowing the built-in `/new`** (rejected): an extension command named `new`
is skipped in autocomplete but hijacks the TUI's built-in `/new` dispatch and
produces a conflict warning at startup.

**Patching pi-telegram** (rejected): its public API deliberately defers
session control; a fork would carry upgrade burden for a capability pi already
exposes to commands.

## Consequences

- If the autocomplete provider is rebuilt later in the same session (settings
  changes, `addAutocompleteProvider` calls) *after* a Telegram `/new` was used,
  `tg-new-session` becomes listed for the remainder of that session. It is
  gone again after the next session replacement. Accepted: cosmetic, rare.
- If the internal name ever drifts from the dispatched string, pi treats the
  text as a normal prompt and the model receives `/tg-new-session`. The two
  literals share one constant to prevent this.
- Repeat `/new` while a swap is in flight is answered with "already starting"
  instead of re-entering; `session_shutdown` (including the swap's own) resets
  the guard. If `newSession` throws, the failure is reported to the Telegram
  chat and the guard resets for retry.
- Completion/cancellation notices use `sendTelegramView` with instance scope;
  without a connected bridge they resolve as structured failures and are
  dropped.
