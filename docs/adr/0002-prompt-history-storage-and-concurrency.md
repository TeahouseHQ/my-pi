# Prompt history: per-project storage, last-writer-wins

History is persisted to a per-project JSON file under pi's config dir, keyed by a hash of the working directory (`~/.pi/agent/prompt-history/<hash>.json`), as a recency-ordered array capped at 200 entries. We deliberately store outside the project tree (not `.pi/prompt-history.jsonl` inside the repo) so prompts can never be accidentally committed and the project stays clean — "per-project" is just the key, not a file location.

Concurrency is **last-writer-wins**: if two pi sessions run in the same project, each reads at start and rewrites on every recorded prompt, so concurrent sessions can drop each other's entries. We accepted this for v1 because the write rate is trivial (one write per submitted prompt) and merge-on-write (re-read + union before each write) adds complexity that isn't worth it for a personal-use feature.

## Consequences

Moving or re-keying the storage location later orphans existing history (no migration planned). If concurrent multi-session use in one project becomes common and lost entries become annoying, revisit with merge-on-write rather than changing the storage shape.
