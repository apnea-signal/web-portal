# Repository Guidelines

## Project Structure & Module Organization
This repository is currently minimal and contains only `README.md` at the root. As features are added, keep a predictable layout:
- `src/` for application code (group by feature, not by file type when possible).
- `tests/` for automated tests mirroring `src/` paths.
- `public/` or `assets/` for static files.
- `docs/` for design notes and architecture decisions.

Example: `src/auth/login.ts` with `tests/auth/login.test.ts`.

## Build, Test, and Development Commands
No build system is configured yet (`package.json`, `Makefile`, and CI scripts are not present).
Until tooling is added, use basic repository checks:
- `git status` to verify a clean working tree before and after changes.
- `git diff --staged` to review exactly what will be committed.

When adding tooling, expose standard commands (for example `npm run dev`, `npm test`, `npm run lint`) and document them in `README.md`.

## Coding Style & Naming Conventions
No formatter/linter is configured yet. Follow these defaults:
- Use 2-space indentation for JS/TS/JSON/YAML.
- Use descriptive, lowercase-kebab-case for directories (`signal-processing/`).
- Use `camelCase` for variables/functions and `PascalCase` for classes/components.
- Keep modules small and focused; avoid large utility files with mixed concerns.

If you introduce ESLint/Prettier (or equivalents), include config files in the same PR.

## Testing Guidelines
There is no test framework configured yet. When adding tests:
- Place tests under `tests/` or colocated `*.test.*` files.
- Name tests by behavior (for example, `login rejects expired token`).
- Add at least one happy-path and one failure-path test per new feature.

## Commit & Pull Request Guidelines
Git history currently shows a simple message style (`first commit`). Going forward:
- Write concise, imperative commit messages (e.g., `Add apnea signal parser`).
- Keep commits focused on one change.
- PRs should include: purpose, scope, test evidence, and follow-up tasks.
- Link related issues and include screenshots for UI changes.

## Security & Configuration Tips
Do not commit secrets. Use `.env.local` for local configuration and provide a sanitized `.env.example` when environment variables are introduced.
