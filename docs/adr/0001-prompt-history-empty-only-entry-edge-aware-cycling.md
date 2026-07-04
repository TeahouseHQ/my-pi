# Prompt history: empty-only entry, edge-aware cycling

The prompt-history recall uses two *different* rules on purpose, which a future reader will question. **Entry** into browsing mode requires an empty editor (pressing `up` on an empty line), so plain typing never gets hijacked by history. But once browsing, **cycling** is edge-aware: within a recalled multi-line entry, `up`/`down` move the cursor between lines and only step to an older/newer entry at the first/last line (zsh/fish behaviour).

We picked this combination because pure empty-only would let you recall just one entry (the editor is non-empty after the first recall, so you could never cycle further), while pure edge-aware entry would let `up` grab history whenever the cursor sat on the first line of in-progress text — surprising mid-edit. Empty-only entry keeps recall opt-in; edge-aware cycling is the only way to actually navigate and edit a recalled multi-line prompt.

## Consequences

After editing a recalled prompt the editor is non-empty, so history can't be re-entered until the editor is cleared. Prefix/substring search (fish-style) is out of scope precisely because it conflicts with the empty-only entry rule — adding it later means relaxing this decision or introducing a dedicated trigger key.
