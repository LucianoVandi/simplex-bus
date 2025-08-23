# Contributing

## Setup

```bash
npm ci
npm run check
```

## Development Rules

- Keep API changes backward-compatible unless the change is intentionally breaking.
- Add or update tests for every behavior change.
- Keep `npm run check` green before opening a PR.
- Prefer small, focused commits with clear messages.

## Pull Requests

A PR should include:
- Problem statement
- Solution summary
- Risk notes (behavioral changes, edge cases)
- Test evidence (`npm run check` output)

## Commit Style

Suggested format:
- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `test: ...`
- `docs: ...`
