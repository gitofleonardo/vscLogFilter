# Android Studio Logcat Filter Reference

Read-only reference sources from AOSP `platform/tools/adt/idea` (Apache 2.0), used to align query parsing and evaluation behavior.

| File | Description |
|------|-------------|
| `LogcatFilter.bnf` | Grammar definition |
| `LogcatFilterParser.kt` | Parser + implicit grouping |
| `LogcatFilter.kt` | Filter evaluation |
| `LogcatFilterParserTest.kt` | Parser golden tests |
| `LogcatFilterTest.kt` | Evaluator golden tests |

Source tree: `logcat/src/com/android/tools/idea/logcat/filters/`

This plugin ports the behavior to TypeScript in `src/query/` with these differences:

- No `package:` / `package:mine` (use `pid:` for offline logs)
- No regex `~:` modifiers (warning shown)
- Added `after:` / `before:` time bounds
- `age:` uses file max timestamp instead of host clock
