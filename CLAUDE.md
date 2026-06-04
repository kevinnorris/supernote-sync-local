## Repo Overview

Bun CLI that performs a single bidirectional sync pass between a Supernote device (HTTP port 8089) and a local directory, then exits.

Terms defined in /docs/UBIQUITOUS_LANGUAGE.md

## Development Commands

bun run test - run the tests
bun run typecheck - run typechecking
bun run fix - have the linter apply automatic fixes
bun run lint - run the linter
bun run check - run all commands (this is the preferred command)

## Technical Guidelines

Prefer Bun-native APIs (bun:sqlite, Bun.file, global fetch) over node:* equivalents where they exist. For more info read /docs/bun.md.

Test files shoudl be written in .js