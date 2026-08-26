# Query Syntax & Implementation

This document describes how the **Android Studio Logcat–compatible query language** is implemented: lexing, parsing, evaluation, result highlighting, and differences from AS.

For a user-facing cheat sheet see [README.md](../README.md). AS reference sources live under [reference/as-logcat/](../reference/as-logcat/).

简体中文: [SYNTAX_CN.md](SYNTAX_CN.md)

---

## 1. Overview

```
User query
    │
    ▼
lexer.ts          tokenize()        WORD / KEY / & / | / ( ) …
    │
    ▼
parser.ts         parseQuery()      FilterNode AST + warnings
    │
    ├──────────────────────────────┐
    ▼                              ▼
evaluator.ts                  highlights.ts
filterEntries()               extractHighlightTerms()
evaluateFilter()              collectHighlightRanges()
    │                              │
    ▼                              ▼
Matched row indices           Webview row marks
(Worker)                      (highlightRanges.js + main.js)
```

| Stage | Source | Output |
|-------|--------|--------|
| Lexer | `src/query/lexer.ts` | `Token[]` |
| Parser | `src/query/parser.ts` | `FilterNode` AST |
| Evaluator | `src/query/evaluator.ts` | per-`LogEntry` match |
| Highlight terms | `src/query/highlights.ts` | `HighlightTerm[]` |
| Highlight ranges | `src/query/highlights.ts` | `HighlightRange[]` |
| Log field spans | `src/log/parser.ts` | `tagStart`, `messageStart`, … |
| UI | `media/main.js`, `media/highlightRanges.js` | `<mark>` rendering |

Filtering runs in the **Worker** (`src/worker/logParser.worker.ts`). Highlight terms are computed in the extension and sent to the webview with row payloads.

---

## 2. Lexer

Implementation: `src/query/lexer.ts` → `tokenize(input)`

### 2.1 Token types

| Type | Lexeme | Notes |
|------|--------|-------|
| `WORD` | bare word or quoted string | free text without a field key |
| `KEY` | `tag:foo`, `-tag=:Bar`, `pid:123` | includes `field`, `keyValue`, `negated`, `mode` |
| `AND` | `&` | explicit AND |
| `OR` | `\|` | explicit OR |
| `LPAREN` / `RPAREN` | `(` `)` | grouping |
| `EOF` | — | end |

### 2.2 Field keys

```
tag | message | line | level | age | is | name | process | pid | after | before | package
```

Keys are **case-insensitive** (stored lowercased in `field`).

### 2.3 Key modifiers

| Form | `mode` | Meaning |
|------|--------|---------|
| `tag:value` | `contains` | substring |
| `tag=:value` | `exact` | full equality |
| `tag~:pattern` | `regex` | **not supported** (see below) |
| `-tag:value` | — | negation (`negated: true`) |

Value forms:

- **Unquoted**: until whitespace, `&`, `|`, `(`, `)`, or the next key; `\` escapes the next character.
- **Quoted** `'…'` / `"…"`: may contain spaces; supports escapes.
- **`after:` / `before:`**: date + space + time (e.g. `08-18 10:44:50`) is one value via `continuesDatetimeValue`.

In bare words, `\ ` (backslash + space) becomes a space character.

---

## 3. Parser

Implementation: `src/query/parser.ts` → `parseQuery(input)`

### 3.1 Pipeline

1. Trim input; empty → `{ ast: null }`.
2. `tokenize` → `parseTopLevel` collects **space-separated expressions**.
3. Each expression is parsed with `parseOrExpr` (`parseAndExpr` → `parsePrimary`).
4. `normalizeTopLevel` applies **same-key implicit OR** on top-level AND children.
5. Trailing `|` / `&` are ignored (incomplete queries while typing).
6. Parse failure → fallback `{ kind: 'phrase', text: full input }` (`fallbackLineSearch`).

### 3.2 Operator precedence

AS-compatible:

```
&  binds tighter than  |
```

Examples:

| Query | Meaning |
|-------|---------|
| `f1 & f2 \| f3 & f4` | `(f1 AND f2) OR (f3 AND f4)` |
| `(tag:a \| tag:b) & level:E` | `(tag:a OR tag:b) AND level:E` |

### 3.3 Whitespace vs explicit operators

| Combination | Meaning |
|-------------|---------|
| **Space-separated expressions** | top-level AND (then same-key OR merge) |
| `\|` inside an expression | OR |
| `&` inside an expression | AND |
| Adjacent primaries **without** `&` | **not** implicitly ANDed inside one expression |

Examples:

| Query | Structure |
|-------|-----------|
| `tag:A tencent \| wakeup pid:1` | `tag:A` AND `(tencent OR wakeup)` AND `pid:1` |
| `tag:SurfaceControl \| transition \| launcher` | three-way OR |
| `foo bar \| baz` | `foo` AND `(bar OR baz)` |
| `foo bar` | `foo` AND `bar` (two top-level phrases) |

### 3.4 Same-key implicit OR (`normalizeTopLevel`)

At the top level, multiple **non-negated** keys with the same field from this set merge into OR:

`tag` · `message` · `line` · `level` · `age` · `pid` · `process`

Rules:

- **Negated** keys (`-tag:`) stay separate (AND).
- **`is:`, `name:`, `after:`, `before:`** never merge.
- **`tag:` and `tag=:`** share the `tag` bucket (e.g. `tag:Runtime tag=:Firebase`).

### 3.5 AST nodes

Defined in `src/query/ast.ts`:

```typescript
type FilterNode =
  | { kind: 'phrase'; text: string }
  | { kind: 'key'; field; value; negated; mode }
  | { kind: 'and'; children: FilterNode[] }
  | { kind: 'or'; children: FilterNode[] }
```

---

## 4. Evaluator

Implementation: `src/query/evaluator.ts`

Recursively evaluates the AST for each `LogEntry`:

| Node | Semantics |
|------|-----------|
| `phrase` | `entry.fullText` contains text (**case-insensitive**) |
| `and` | all children true |
| `or` | any child true |
| `key` | see table; negated inverts |

### 4.1 Field evaluation

| Field | Scope | contains | exact (`=:`) | Notes |
|-------|-------|----------|--------------|-------|
| `tag` | `entry.tag` | substring, case-insensitive | **case-sensitive** equality | |
| `message` | `entry.message` | same | same | includes merged continuations |
| `line` | `entry.fullText` | same | same | includes stack continuations |
| `level` | `entry.level` | **≥** given level | — | `W` → WARN and above |
| `process` | `process ?? tag` | substring | — | |
| `pid` | `entry.pid` | numeric prefix | integer equality | non-numeric value → no match |
| `age` | timestamp | — | — | relative to **file max time**; `5m`/`10s`/`2h`/`1d` |
| `after` | `entry.parsedTime` | — | — | ≥ bound |
| `before` | `entry.parsedTime` | — | — | ≤ bound |
| `is` | presets | — | — | see 4.2 |
| `name` | — | — | — | **always true** (saved filter name only) |

`FilterContext`: `fileMaxTime`, `baseYear` (for partial dates in `after`/`before`).

### 4.2 `is:` presets

| Value | Behavior |
|-------|----------|
| `crash` | `FATAL EXCEPTION`, `Process: … has died`, etc. |
| `stacktrace` | `at …(…:line)`, `Caused by:`, etc. |
| `firebase` | Firebase-related tag patterns |
| level names or `V`/`D`/… | exact level |

### 4.3 Unsupported constructs

| Input | Behavior |
|-------|----------|
| `tag~:` / `-tag~:` | warning; key ignored (empty line filter) |
| `package:` | warning; ignored |
| parse error | whole string as `phrase` on `fullText` |

---

## 5. Result highlighting

Highlighting **does not affect filtering**; it only decorates matched rows in the webview.

### 5.1 Pipeline

```
query → parseQuery → AST
  → extractHighlightTerms → HighlightTerm[]
  → extension → webview (highlightTerms)
  → each SerializedLogEntry (tagStart, …)
  → LogFilterHighlights.collectHighlightRanges(fullText, terms, row)
  → main.js renderHighlightRanges → <mark class="match-hl">
```

Shared logic: `src/query/highlights.ts`  
Webview bundle: `npm run build` → `media/highlightRanges.js` (global `LogFilterHighlights`)

### 5.2 Extracting terms (`extractHighlightTerms`)

Walks the AST and collects non-negated, non-regex keys with values, plus all phrases:

| AST | Highlight? |
|-----|------------|
| `tag:foo` | yes `{ field:'tag' }` |
| `tag=:Foo` | yes `{ exact:true }` |
| `-tag:foo` | no |
| `tag~:x` | no |
| `level:E` | no (no field mapping) |
| `process:x` | yes, mapped to `field:'tag'` |
| `phrase` | yes `field:'any'` (whole line) |

Dedup key: `field + text + exact`.

### 5.3 Row ranges (`collectHighlightRanges`)

Inputs: row `fullText`, term list, `RowHighlightMeta`.

#### Row metadata (parse time)

`src/log/parser.ts` sets on `LogEntry`; Worker copies to `SerializedLogEntry`:

| Field | Meaning |
|-------|---------|
| `tagStart` / `tagEnd` | Tag span on the **first** log line within `fullText` |
| `messageStart` / `messageEnd` | Message span; `messageEnd` grows when continuations are appended |

Stack continuations do not move the tag span.

#### Field-aware rules

| Case | Algorithm |
|------|-----------|
| `field:'tag'` + span | match only inside `[tagStart, tagEnd)` |
| `field:'message'` + span | match only inside `[messageStart, messageEnd)` |
| `field:'line'` + exact | highlight whole row if `fullText === term.text` |
| `field:'any'` / default | search entire `fullText` |
| contains | case-insensitive, all occurrences |
| exact without span (e.g. pid) | case-insensitive substring + **boundary check** |

#### Exact boundaries (`isExactHighlightBoundary`)

For exact terms without a field span:

- Default: whitespace or line edge before/after.
- `pid`: no adjacent digits (avoid matching inside longer numbers).

#### exact on tag / message spans

**Case-sensitive** full-span equality (matches evaluator exact).

So `tag=:AlarmManager` highlights the tag field only; `tag:Alarm` highlights inside the tag span, not the same text in the message.

### 5.4 Query input coloring

`tokenizeQueryForDisplay` + `renderQueryHighlightHtml` color the query field (keys/values/operators); independent of filter AST.

### 5.5 Find in results

In-panel Find uses `find-hl` / `find-current`, layered above `match-hl` with higher priority for the active find match.

---

## 6. Worked examples

### 6.1 `tag=:AlarmManager`

- **Filter**: `entry.tag === 'AlarmManager'` (case-sensitive)
- **Highlight**: entire tag span when it equals exactly

### 6.2 `tag:AlarmManager tencent | wakeup pid:2917`

```
AND(
  key tag contains "AlarmManager",
  OR(phrase "tencent", phrase "wakeup"),
  key pid prefix "2917"
)
```

### 6.3 `tag:SurfaceControl | transition | launcher`

```
OR(key tag "SurfaceControl", phrase "transition", phrase "launcher")
```

### 6.4 Continuation lines

```
08-18 … I AndroidRuntime: FATAL EXCEPTION
    at com.example.Foo.bar(Foo.java:10)
```

- `message` / `line` filters see the full merged text.
- `tag=:AndroidRuntime` highlight uses the first-line tag span.
- `message:Caused` can highlight inside continuations (extended message span).

---

## 7. Differences from Android Studio

| Topic | AS | This plugin |
|-------|-----|-------------|
| `package:` / `package:mine` | supported | warning + ignore; use `pid:` offline |
| `tag~:` regex | supported | warning + ignore |
| `age:` clock | host now | **last log timestamp in file** |
| `after:` / `before:` | — | **extension** |
| consecutive bare words | configurable join | top-level AND, **not** joined into one phrase |
| `name:` | saved filter name | parsed, no filter effect |
| empty `()` | EmptyFilter | not implemented |

Tests: `test/parser.test.ts`, `test/highlights.test.ts`; AS goldens in `reference/as-logcat/`.

---

## 8. Source index

| Topic | Path |
|-------|------|
| Lexer | `src/query/lexer.ts` |
| Parser | `src/query/parser.ts` |
| AST | `src/query/ast.ts` |
| Evaluator | `src/query/evaluator.ts` |
| Highlights | `src/query/highlights.ts` |
| Public API | `src/query/index.ts` |
| Log spans | `src/log/parser.ts` |
| Worker | `src/worker/logParser.worker.ts` |
| Webview | `media/main.js`, `media/highlightRanges.js` |
| Parser tests | `test/parser.test.ts` |
| Highlight tests | `test/highlights.test.ts` |

---

## 9. Changing behavior

1. Update `src/query/` and (if spans change) `src/log/parser.ts`
2. Rebuild webview bundle (`npm run build` → `media/highlightRanges.js`)
3. Add/update tests in `test/parser.test.ts` and/or `test/highlights.test.ts`
4. Run `npm run build && npm test`

See [DEVELOPMENT.md](DEVELOPMENT.md).
