# 查询语法与实现

本文档描述 Log Filter 的 **Android Studio Logcat 兼容查询语言**在代码中的完整实现：词法、语法、求值、结果高亮，以及与 AS 的差异。

用户向语法速查见 [README_CN.md](../README_CN.md)。行为对齐参考见 [reference/as-logcat/](../reference/as-logcat/)。

English: [SYNTAX.md](SYNTAX.md)

---

## 1. 总览

```
用户输入 query
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
匹配行索引                    Webview 行内高亮
(Worker)                      (highlightRanges.js + main.js)
```

| 阶段 | 源文件 | 输出 |
|------|--------|------|
| 词法 | `src/query/lexer.ts` | `Token[]` |
| 语法 | `src/query/parser.ts` | `FilterNode` AST |
| 求值 | `src/query/evaluator.ts` | 每条 `LogEntry` 是否匹配 |
| 高亮词条 | `src/query/highlights.ts` | `HighlightTerm[]` |
| 高亮区间 | `src/query/highlights.ts` | `HighlightRange[]` |
| 日志字段 span | `src/log/parser.ts` | `tagStart` / `messageStart` 等 |
| UI | `media/main.js`, `media/highlightRanges.js` | 渲染 `<mark>` |

过滤在 **Worker**（`src/worker/logParser.worker.ts`）中执行；高亮词条由扩展侧 `extractHighlightTerms` 算出后随消息发给 Webview。

---

## 2. 词法（Lexer）

实现：`src/query/lexer.ts` → `tokenize(input)`

### 2.1 Token 类型

| 类型 | 字面 | 说明 |
|------|------|------|
| `WORD` | 裸词或引号字符串 | 无字段前缀的自由文本 |
| `KEY` | `tag:foo`、`-tag=:Bar`、`pid:123` | 带字段键；含 `field`、`keyValue`、`negated`、`mode` |
| `AND` | `&` | 显式与 |
| `OR` | `\|` | 显式或 |
| `LPAREN` / `RPAREN` | `(` `)` | 分组 |
| `EOF` | — | 结束 |

### 2.2 支持的字段键

```
tag | message | line | level | age | is | name | process | pid | after | before | package
```

键名 **不区分大小写**（lexer 统一转小写存入 `field`）。

### 2.3 键修饰符

| 写法 | `mode` | 含义 |
|------|--------|------|
| `tag:value` | `contains` | 子串包含 |
| `tag=:value` | `exact` | 精确相等 |
| `tag~:pattern` | `regex` | 正则（**本插件不支持**，见下文） |
| `-tag:value` | — | 否定（`negated: true`） |

值可读法：

- **无引号**：到空白、`&`、`|`、`(`、`)` 或下一个键为止；`\` 转义下一字符。
- **单/双引号**：引号内可含空白；支持 `\"`、`\'`、`\\` 等转义。
- **`after:` / `before:`**：`08-18 10:44:50` 这类「日期 + 空格 + 时间」在词法层合并为一个值（`continuesDatetimeValue`）。

裸词中 `\ `（反斜杠 + 空格）在词法层变为空格字符。

---

## 3. 语法（Parser）

实现：`src/query/parser.ts` → `parseQuery(input)`

### 3.1 解析流程

1. `trim` 输入；空串 → `{ ast: null }`。
2. `tokenize` → `parseTopLevel` 收集 **空格分隔的多个表达式**。
3. 每个表达式由 `parseOrExpr` 解析（内部 `parseAndExpr` → `parsePrimary`）。
4. `normalizeTopLevel` 对顶层 AND 子节点做 **同键隐式 OR** 合并。
5. 尾部单独的 `|` / `&` 忽略（便于输入过程中不完整查询仍可用）。
6. 解析失败 → **回退**为 `{ kind: 'phrase', text: 全文 }` 整行搜索（`fallbackLineSearch`）。

### 3.2 运算符优先级

与 AS 一致：

```
&  高于  |
```

示例：

| 查询 | AST 语义 |
|------|----------|
| `f1 & f2 \| f3 & f4` | `(f1 AND f2) OR (f3 AND f4)` |
| `(tag:a \| tag:b) & level:E` | `(tag:a OR tag:b) AND level:E` |

### 3.3 空格 vs 显式运算符

| 组合方式 | 含义 |
|----------|------|
| 空格分隔的 **多个表达式** | 顶层 AND（再经同键隐式 OR 归并） |
| 表达式内的 `\|` | OR |
| 表达式内的 `&` | AND |
| 表达式内 **无** `&` 的相邻 primary | **不会** 隐式 AND（与旧版「空格即 AND」不同） |

示例：

| 查询 | 结构 |
|------|------|
| `tag:A tencent \| wakeup pid:1` | `tag:A` AND `(tencent OR wakeup)` AND `pid:1` |
| `tag:SurfaceControl \| transition \| launcher` | 三者 OR |
| `foo bar \| baz` | `foo` AND `(bar OR baz)` |
| `foo bar` | `foo` AND `bar`（两个顶层 phrase） |

### 3.4 同键隐式 OR（`normalizeTopLevel`）

空格分隔、且最终落在顶层 AND 中的多个 **非否定** 键，若属于下列字段且 **键名相同**，合并为一个 OR 节点：

`tag` · `message` · `line` · `level` · `age` · `pid` · `process`

规则：

- **否定键**（`-tag:`）各自独立，与其他项 AND。
- **`is:`、`name:`、`after:`、`before:`** 各自独立（不参与同键 OR）。
- **`tag:` 与 `tag=:`** 同属 `tag` 桶，可隐式 OR（如 `tag:Runtime tag=:Firebase`）。

### 3.5 AST 节点

定义：`src/query/ast.ts`

```typescript
type FilterNode =
  | { kind: 'phrase'; text: string }
  | { kind: 'key'; field; value; negated; mode }
  | { kind: 'and'; children: FilterNode[] }
  | { kind: 'or'; children: FilterNode[] }
```

---

## 4. 求值（Evaluator）

实现：`src/query/evaluator.ts`

对每条 `LogEntry` 递归求值 AST：

| 节点 | 语义 |
|------|------|
| `phrase` | `entry.fullText` **不区分大小写**包含该文本 |
| `and` | 所有子节点为真 |
| `or` | 任一子节点为真 |
| `key` | 见下表；`negated` 时取反 |

### 4.1 字段求值

| 字段 | 作用域 | contains | exact (`=:`) | 备注 |
|------|--------|----------|--------------|------|
| `tag` | `entry.tag` | 子串，忽略大小写 | **区分大小写**全等 | |
| `message` | `entry.message` | 同上 | 同上 | 含续行合并后的 message |
| `line` | `entry.fullText` | 同上 | 同上 | 含 stack trace 续行 |
| `level` | `entry.level` | 级别 **≥** 指定级别 | — | `W` → WARN 及以上 |
| `process` | `process ?? tag` | 子串 | — | 无 exact 分支时走 contains |
| `pid` | `entry.pid` | 数字前缀匹配 | 整数全等 | 非纯数字值 → 不匹配 |
| `age` | 时间戳 | — | — | 相对 **文件内最大时间**；`5m`/`10s`/`2h`/`1d` |
| `after` | `entry.parsedTime` | — | — | ≥ 解析后的下界 |
| `before` | `entry.parsedTime` | — | — | ≤ 解析后的上界 |
| `is` | 预设 | — | — | 见 4.2 |
| `name` | — | — | — | **恒为 true**（仅 AS 保存名，不参与过滤） |

`FilterContext`：`fileMaxTime`（文件最大时间戳）、`baseYear`（解析 `after`/`before` 缺省年份）。

### 4.2 `is:` 预设

| 值 | 行为 |
|----|------|
| `crash` | `FATAL EXCEPTION`、`Process: … has died` 等 |
| `stacktrace` | `at …(…:line)`、`Caused by:` 等 |
| `firebase` | Firebase 相关 tag 模式 |
| `verbose`/`debug`/… 或 `V`/`D`/… | 精确级别 |

### 4.3 不支持项的处理

| 输入 | 行为 |
|------|------|
| `tag~:` / `-tag~:` | 警告；键变为空 `line` 过滤（等价忽略） |
| `package:` | 警告；同上 |
| 解析异常 | 整句作为 `phrase` 在 `fullText` 中搜索 |

---

## 5. 结果高亮

高亮 **不参与过滤**，仅影响 Webview 中匹配行的展示。

### 5.1 流水线

```
query
  → parseQuery → AST
  → extractHighlightTerms(ast) → HighlightTerm[]
  → 扩展发给 Webview（highlightTerms）
  → 每行 SerializedLogEntry（含 tagStart 等）
  → LogFilterHighlights.collectHighlightRanges(fullText, terms, row)
  → main.js renderHighlightRanges → <mark class="match-hl">
```

共享实现：`src/query/highlights.ts`  
Webview  bundle：`npm run build` → `media/highlightRanges.js`（全局 `LogFilterHighlights`）

### 5.2 从高亮 AST 提取词条（`extractHighlightTerms`）

遍历 AST，收集 **非否定、非 regex、有值** 的键，以及所有 `phrase`：

| AST | 是否高亮 |
|-----|----------|
| `tag:foo` | ✓ `{ text:'foo', field:'tag' }` |
| `tag=:Foo` | ✓ `{ exact:true }` |
| `-tag:foo` | ✗ 否定不高亮 |
| `tag~:x` | ✗ |
| `level:E` | ✗（无 field 映射） |
| `process:x` | ✓ 映射为 `field:'tag'` |
| `phrase` | ✓ `field:'any'`，搜整行 |

去重键：`field + text + exact`。

### 5.3 行内区间（`collectHighlightRanges`）

输入：行文本 `fullText`、词条列表、行元数据 `RowHighlightMeta`。

#### 行元数据（解析时写入）

`src/log/parser.ts` 在解析 logcat 行时写入 `LogEntry`，Worker 序列化进 `SerializedLogEntry`：

| 字段 | 含义 |
|------|------|
| `tagStart` / `tagEnd` | 首行 logcat 格式中 **Tag** 在 `fullText` 内的区间 |
| `messageStart` / `messageEnd` | **Message** 区间；续行追加时 `messageEnd` 延伸至 `fullText.length` |

续行 stack trace 不影响 tag 区间（tag 仅在首行）。

#### 按字段高亮

| 条件 | 算法 |
|------|------|
| `field:'tag'` 且有 span | 仅在 `[tagStart, tagEnd)` 内匹配 |
| `field:'message'` 且有 span | 仅在 `[messageStart, messageEnd)` 内匹配 |
| `field:'line'` 且 `exact` | 整行 `fullText === term.text`（区分大小写）则整行高亮 |
| `field:'any'` 或其它 | 在整行 `fullText` 搜索 |
| contains | 不区分大小写，找 **所有** 出现位置 |
| exact（无 span 的字段，如 pid） | 不区分大小写比对子串 + **边界检测** |

#### exact 边界（`isExactHighlightBoundary`）

用于 **无字段 span** 时的 exact（如 `pid=`、裸 exact）：

- 默认：前字符为行首或空白，后字符为空白或行尾。
- `pid`：前后不能紧邻数字（避免 `2917` 匹配到 `29171` 的一部分）。

#### tag / message 的 exact

在字段 span 内：**区分大小写** 整段相等才高亮（与 evaluator 的 exact 一致）。

因此 `tag=:AlarmManager` 高亮 tag 字段，而不会在 message 里误高亮子串；`tag:Alarm` 只高亮 tag 段内的 `Alarm`，不会高亮 message 中的相同文本。

### 5.4 查询框语法高亮

`tokenizeQueryForDisplay` + `renderQueryHighlightHtml`：在输入框叠加着色（键/值/运算符/短语），与过滤 AST **独立**，仅 UI 用。

### 5.5 Find in results

面板内 **Find**（`Ctrl+F`）使用 `find-hl` / `find-current` 类，与查询高亮 `match-hl` 分层渲染；查询高亮优先级低于当前 Find 匹配。

---

## 6. 示例对照

### 6.1 `tag=:AlarmManager`

- **过滤**：`entry.tag === 'AlarmManager'`（区分大小写）
- **高亮**：在 `tagStart..tagEnd` 精确相等则标记整段 tag

### 6.2 `tag:AlarmManager tencent | wakeup pid:2917`

```
AND(
  key tag contains "AlarmManager",
  OR(phrase "tencent", phrase "wakeup"),
  key pid contains "2917"   // 前缀匹配 pid
)
```

### 6.3 `tag:SurfaceControl | transition | launcher`

```
OR(
  key tag contains "SurfaceControl",
  phrase "transition",
  phrase "launcher"
)
```

### 6.4 带续行的 crash 行

```
08-18 ... I AndroidRuntime: FATAL EXCEPTION
    at com.example.Foo.bar(Foo.java:10)
```

- `message` / `line` 过滤含续行全文。
- `tag=:AndroidRuntime` 高亮仍用首行 tag span。
- `message:Caused` 可在续行部分高亮（message span 含续行）。

---

## 7. 与 Android Studio 的差异

| 项目 | AS | 本插件 |
|------|-----|--------|
| `package:` / `package:mine` | 支持 | 警告并忽略；离线用 `pid:` |
| `tag~:` 等 regex | 支持 | 警告并忽略 |
| `age:` 基准 | 主机当前时间 | **文件内最后一条日志时间** |
| `after:` / `before:` | 无 | **扩展**；相对日志年份 |
| 连续裸词 `foo bar` | 默认不合并（可配置 join） | 顶层两项 AND，**不**合并为 `"foo bar"` 短语 |
| `name:` | 保存过滤器名称 | 解析但不参与过滤 |
| 空括号 `()` | EmptyFilter | 未实现 |

对齐测试：`test/parser.test.ts`（语法/过滤）、`test/highlights.test.ts`（高亮）；AS golden：`reference/as-logcat/LogcatFilterParserTest.kt`。

---

## 8. 源码索引

| 主题 | 路径 |
|------|------|
| 词法 | `src/query/lexer.ts` |
| 语法 | `src/query/parser.ts` |
| AST | `src/query/ast.ts` |
| 求值 | `src/query/evaluator.ts` |
| 高亮 | `src/query/highlights.ts` |
| 对外 API | `src/query/index.ts` |
| 日志解析与 span | `src/log/parser.ts` |
| Worker 过滤/序列化 | `src/worker/logParser.worker.ts` |
| Webview | `media/main.js`, `media/highlightRanges.js` |
| 语法测试 | `test/parser.test.ts` |
| 高亮测试 | `test/highlights.test.ts` |

---

## 9. 修改与验证

变更 query 行为时：

1. 更新 `src/query/` 与（若涉及 span）`src/log/parser.ts`
2. 同步 `media/highlightRanges-entry.ts` 所打包的 `highlights.ts`（`npm run build`）
3. 补充 `test/parser.test.ts` / `test/highlights.test.ts`
4. 运行 `npm run build && npm test`

详见 [DEVELOPMENT_CN.md](DEVELOPMENT_CN.md)。
