# Changelog

## [Unreleased]

### Added
- Typed public definitions (`index.d.ts`).
- Expanded bus lifecycle API (`once`, `off`, `dispose`).
- Typed error exports for runtime failure classification.
- CI pipeline for test and quality gates.
- Contribution, security, and conduct documentation.
- Trusted response guard (`isTrustedResponse`) for provenance checks in untrusted transports.
- Automated dependency update configuration (`.github/dependabot.yml`).

### Changed
- Hardened request/response correlation and validation flow.
- Added configurable parser/serializer/logger hooks.
- Added abort support for requests.
- Request IDs now use random UUIDs when available (with random fallback).
- Coverage gate parser now tolerates formatting differences in test coverage output.
- CI quality job removes duplicated test run while adding `npm audit` high-severity gate.

### Test
- Added comprehensive automated test suite including edge cases.
- Added coverage gate script with thresholds.
