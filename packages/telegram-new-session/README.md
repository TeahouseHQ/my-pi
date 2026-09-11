# telegram-new-session

Adds `/new` to the paired Telegram chat: it finishes any in-flight turn, then
replaces the current session with a fresh one and confirms in the chat.

Telegram-only by design — nothing is added to the TUI's `/` command menu
(ADR 0015). Requires the `@llblab/pi-telegram` bridge to be connected for
delivery; without a connection the command simply never triggers.
