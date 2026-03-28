# GlitchTip authorization bypass PoC

This PoC documents and reproduces the GlitchTip authorization mismatch identified in the local audit material under `C:\GitHub\glitchtip-issues` (`SECURITY_AUDIT.md` and `SECURITY_POCS.md`, issue `GTSEC-001` in those notes).

## Vulnerability summary

The issue is an authorization bypass on session-authenticated requests for mutating endpoints.  
Bearer token checks enforce scopes, but some browser session flows can still reach write operations with insufficient privileges.

In practical terms, a low-privilege member session may succeed on project mutation routes where an equivalent read-only bearer token is rejected (`401/403`).

## Timeline

- **2026-06-03**: issue discovered
- **2026-06-03**: issue reported to maintainer (same day)

## Fix and references

- Merge request (patch): https://gitlab.com/glitchtip/glitchtip-backend/-/merge_requests/2377
- Commit: https://gitlab.com/glitchtip/glitchtip-backend/-/commit/1c5c6d55d49bc9a61902864a489b21cc690377ea
- Fixed release: https://gitlab.com/glitchtip/glitchtip-backend/-/releases/v6.1.7

## Usage

```sh
npx ts-node .\glitchtip-poc.ts --url http://localhost:8000 --org org --project project --token TOKEN --session-id SESSION
```

If you omit values, the CLI prompts for them when run in a terminal.

## Flags

- `--url`
- `--org`
- `--project`
- `--token`
- `--session-id`
- `--csrf-token`
- `--method` (`GET`, `PUT`, `DELETE`)
- `--field` (`title`, `slug`, `platform`)
- `--title`
- `--name`
- `--slug`
- `--platform`
