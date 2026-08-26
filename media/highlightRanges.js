"use strict";
var LogFilterHighlights = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // media/highlightRanges-entry.ts
  var highlightRanges_entry_exports = {};
  __export(highlightRanges_entry_exports, {
    collectHighlightRanges: () => collectHighlightRanges
  });

  // src/query/lexer.ts
  var KEY_NAMES = "tag|message|line|level|age|is|name|process|pid|after|before|package";
  var KEY_PATTERN = new RegExp(
    `^-?(?:${KEY_NAMES})(?:~|=)?:`,
    "i"
  );

  // src/query/highlights.ts
  function collectHighlightRanges(text, terms, row = {}) {
    const ranges = [];
    if (!text || !terms.length) {
      return ranges;
    }
    const hay = text.toLowerCase();
    for (const term of terms) {
      if (!term.text) {
        continue;
      }
      if (term.field === "tag" && row.tagStart != null && row.tagEnd != null) {
        collectInFieldSpan(text, row.tagStart, row.tagEnd, term, ranges);
        continue;
      }
      if (term.field === "message" && row.messageStart != null && row.messageEnd != null) {
        collectInFieldSpan(text, row.messageStart, row.messageEnd, term, ranges);
        continue;
      }
      if (term.field === "line" && term.exact) {
        if (text === term.text) {
          ranges.push({ start: 0, end: text.length });
        }
        continue;
      }
      const needle = term.text.toLowerCase();
      if (term.exact) {
        let idx2 = 0;
        while (idx2 <= hay.length) {
          if (hay.slice(idx2, idx2 + needle.length) === needle) {
            const end = idx2 + needle.length;
            if (isExactHighlightBoundary(hay, idx2, end, term.field)) {
              ranges.push({ start: idx2, end });
            }
            idx2 += needle.length;
          } else {
            idx2++;
          }
        }
        continue;
      }
      let idx = 0;
      while (idx < hay.length) {
        const found = hay.indexOf(needle, idx);
        if (found === -1) {
          break;
        }
        ranges.push({ start: found, end: found + needle.length });
        idx = found + 1;
      }
    }
    return ranges;
  }
  function collectInFieldSpan(text, spanStart, spanEnd, term, ranges) {
    const slice = text.slice(spanStart, spanEnd);
    if (term.exact) {
      if (slice === term.text) {
        ranges.push({ start: spanStart, end: spanEnd });
      }
      return;
    }
    const hay = slice.toLowerCase();
    const needle = term.text.toLowerCase();
    let idx = 0;
    while (idx < hay.length) {
      const found = hay.indexOf(needle, idx);
      if (found === -1) {
        break;
      }
      ranges.push({
        start: spanStart + found,
        end: spanStart + found + needle.length
      });
      idx = found + 1;
    }
  }
  function isExactHighlightBoundary(hay, start, end, field) {
    const beforeOk = start === 0 || /\s/.test(hay[start - 1]);
    if (end === hay.length) {
      return beforeOk;
    }
    const afterChar = hay[end];
    if (field === "pid") {
      const beforeDigitOk = start === 0 || !/\d/.test(hay[start - 1]);
      return beforeDigitOk && !/\d/.test(afterChar);
    }
    return beforeOk && /\s/.test(afterChar);
  }
  var KEY_NAMES2 = "tag|message|line|level|age|is|name|process|pid|after|before|package";
  var KEY_PATTERN2 = new RegExp(`^-?(?:${KEY_NAMES2})(?:~|=)?:`, "i");
  return __toCommonJS(highlightRanges_entry_exports);
})();
//# sourceMappingURL=highlightRanges.js.map
