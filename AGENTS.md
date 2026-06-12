## Agent skills

### Issue tracker

Issues live in GitHub (TeahouseHQ/my-pi), managed via `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Using the default five-label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## Definition of done

- Run `npm run check` to run all checks before calling an implementation complete.