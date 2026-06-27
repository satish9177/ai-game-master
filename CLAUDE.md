# CLAUDE.md — Claude Code Instructions

Before coding, read and follow `AGENTS.md`.

`AGENTS.md` is the source of truth for:
- workflow
- architecture boundaries
- Minimum Safe Change Rule
- generation safety
- memory/firewall rules
- logging rules
- verification rules

Do not duplicate or override `AGENTS.md`.

## Claude-specific rules

- Design first. Do not implement until the maintainer approves.
- Keep one small feature slice at a time.
- Reuse existing code before adding new abstractions.
- Use the Minimum Safe Change Rule from `AGENTS.md`.
- Never weaken validation, safety boundaries, memory firewalls, or logging redaction to reduce code.
- Do not auto-commit.
- Do not run broad expensive commands unless needed; prefer targeted tests first.
- Before implementation, provide:
  1. existing code to reuse
  2. minimum new code needed
  3. safety boundaries unchanged
  4. targeted tests
  5. verification commands

## Required reads

Always read:
1. `AGENTS.md`
2. `docs/architecture/ARCHITECTURE.md`
3. `docs/architecture/BOUNDARIES.md`

Read relevant ADRs only when the task touches that feature area.