# Log Filter

English | [简体中文](README_CN.md)

Android Studio Logcat-style log filtering for VS Code. Run **Log Filter: Open** (`Ctrl+Shift+L`) to filter with AS-compatible query syntax in a Beside Webview tab.

## Features

- **Dual-tab workflow**: source log editor + filter webview panel side by side
- **AS Logcat query syntax** (except regex `~` modifiers)
- **Extensions**: `pid:`, `after:`, `before:` for offline logs
- **Virtual scrolling** for large result sets
- **Double-click / Enter** to jump to source line
- **Auto-reveal** filter tab when switching between open files
- **Large files**: reads the editor buffer when VS Code exposes it; otherwise streams from disk via Worker; optional size confirmation (see Settings)

## Usage

1. Click the **filter icon** in the editor title bar, or press `Ctrl+Shift+L`
2. Type a filter query in the filter panel
3. Double-click a row to jump to the corresponding line in the source editor

## Example

Filter a large offline logcat dump with field keys, explicit OR, and a time lower bound:

```
tag:AlarmManager pid:2917 tencent | device after:10:50:00
```

![Log Filter example: source editor and filtered results side by side](docs/example.png)

Space-separated terms are combined with AND (same key → implicit OR). Explicit `|` / `&` are boolean OR / AND with normal precedence, so keys can participate in OR (e.g. `tag:SurfaceControl | transition`). Matching lines show keyword highlights.

## Query Syntax

| Syntax | Meaning |
|--------|---------|
| `tag:foo` | Tag contains `foo` |
| `tag=:foo` | Tag equals `foo` exactly |
| `-tag:foo` | Exclude tag containing `foo` |
| `message:text` | Message contains text |
| `line:text` | Full entry (incl. continuations) contains text |
| `level:W` | WARN and above |
| `pid:5689` | Process ID match |
| `age:5m` | Within 5 minutes of last log timestamp |
| `is:crash` / `is:stacktrace` / `is:firebase` | Preset filters |
| `after:11:02:00` / `before:11:05:00` | Time bounds |
| `foo bar` | Both terms must appear on the full entry (AND) |
| `tag:a tag:b` | Implicit OR for same key |
| `tag:a -tag:b pid:1` | AND when negation present |
| `tag:foo \| bar` | Explicit OR (keys and text) |
| `(tag:a \| tag:b) & level:E` | Explicit grouping |

**Not supported:** `package:` (use `pid:`), `tag~:` regex (shows warning).

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `logFilter.confirmBeforeParseSizeMB` | `0` | Optional confirm before parsing large files (MB). `0` = off. |
| `logFilter.parseDebounceMs` | `200` | Debounce after log edits before re-parse. |
| `logFilter.queryDebounceMs` | `300` | Debounce after query edits before re-filter. |

Parsing uses a Worker thread and streams file content when the editor buffer is unavailable (common for very large logs). Stale Worker results are discarded when the file or query changes.

## Development

```bash
npm install
npm run build
npm test
```

Press F5 in VS Code to launch Extension Development Host.

**Required:** after feature or behavior changes, update tests under `test/` and run the **full** suite with `npm test` before finishing. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) ([中文](docs/DEVELOPMENT_CN.md)).

## Reference

Android Studio Logcat filter sources (Apache 2.0) are vendored under `reference/as-logcat/` for behavioral alignment.

## License

Apache License 2.0. See LICENSE and NOTICE.
