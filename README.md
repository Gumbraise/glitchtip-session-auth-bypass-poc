# GlitchTip PoC (no CVE)

Interactive proof of concept for project access checks.

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
