# Log Filter

Android Studio Logcat-style log filtering for VS Code. Run **Log Filter: Open** (`Ctrl+Shift+L`) to filter with AS-compatible query syntax in a Beside Webview tab.

## Features

- **Dual-tab workflow**: source log editor + filter webview panel side by side
- **AS Logcat query syntax** (except regex `~` modifiers)
- **Extensions**: `pid:`, `after:`, `before:` for offline logs
- **Virtual scrolling** for large result sets
- **Double-click / Enter** to jump to source line
- **Auto-reveal** filter tab when switching between open files
- **Large files** (Phase 1b): ≥10 MB uses Worker thread + chunked parsing; ≥100 MB shows confirmation; progress bar in Filter tab

## Large files (Phase 1b)

| File size | Behavior |
|-----------|----------|
| < 10 MB | Extension Host sync parse |
| 10 MB – 100 MB | Worker thread, 5000 lines/chunk, progress bar |
| ≥ 100 MB | Warning dialog before parsing |

Editing the log while Filter is open debounces re-parse; stale Worker results are discarded.

## Usage

1. Click the **filter icon** in the editor title bar, or press `Ctrl+Shift+L`
2. Type a filter query in the filter panel
3. Double-click a row to jump to the corresponding line in the source editor

## Example

Filter a large offline logcat dump with field keys, text OR, and a time lower bound:

```
tag:AlarmManager pid:2917 tencent | device after:10:50:00
```

![Log Filter example: source editor and filtered results side by side](docs/example.png)

The query keeps `tag:` / `pid:` / `after:` as global AND conditions, uses `|` only for text OR (`tencent` or `device`), and shows matching lines with keyword highlights.

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
| `foo bar` | Phrase search on full entry |
| `tag:a tag:b` | Implicit OR for same key |
| `tag:a -tag:b pid:1` | AND when negation present |
| `(tag:a \| tag:b) & level:E` | Explicit grouping |

**Not supported:** `package:` (use `pid:`), `tag~:` regex (shows warning).

## Development

```bash
npm install
npm run build
npm test
```

Press F5 in VS Code to launch Extension Development Host.

## Reference

Android Studio Logcat filter sources (Apache 2.0) are vendored under `reference/as-logcat/` for behavioral alignment.

## License

Apache License 2.0. See LICENSE and NOTICE.
