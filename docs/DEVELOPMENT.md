# Development Guidelines

## Testing requirements (mandatory)

### 1. Add or update tests with behavior changes

- When adding or changing behavior (parsing, filtering, evaluation, Worker, session, etc.), **must** add or update corresponding cases under `test/`.
- Prefer covering: happy path, edges (empty input, trailing `|` / `&`), regressions for Android Studio Logcat semantics, and counterexamples that would fail before the fix.
- Query-syntax changes should align with `reference/as-logcat/` and name the scenario clearly in tests (e.g. explicit OR, same-key implicit OR).

### 2. Run the full suite after feature work

Before treating a change as done (ready to ship or commit), **must** run from the repo root:

```bash
npm test
```

- The full suite must pass; do not stop after a single test file.
- If anything fails: fix code or tests, then re-run until green. Do not merge/commit with failing tests.

### Suggested workflow

1. Implement the feature or fix  
2. Add / update tests  
3. `npm test` (full suite) passes  
4. Then commit / open a PR  

## Common commands

```bash
npm install
npm run build
npm test
```

Press F5 in VS Code to launch the Extension Development Host for manual checks.

---

简体中文：[DEVELOPMENT_CN.md](DEVELOPMENT_CN.md)
