"use strict";
var LogFilterFindNav = (() => {
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

  // media/findNavigation-entry.ts
  var findNavigation_entry_exports = {};
  __export(findNavigation_entry_exports, {
    compareFindPos: () => compareFindPos,
    computeNextFindIndex: () => computeNextFindIndex,
    computePrevFindIndex: () => computePrevFindIndex,
    findMatchIndexAtOrAfter: () => findMatchIndexAtOrAfter,
    findMatchIndexBefore: () => findMatchIndexBefore,
    resolveMatchFromAnchor: () => resolveMatchFromAnchor
  });

  // src/session/findNavigation.ts
  function compareFindPos(a, b) {
    if (a.rowIndex !== b.rowIndex) {
      return a.rowIndex - b.rowIndex;
    }
    const aOff = a.offset ?? a.start ?? 0;
    const bOff = b.offset ?? b.start ?? 0;
    return aOff - bOff;
  }
  function findMatchIndexAtOrAfter(matches, rowIndex, offset) {
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.rowIndex > rowIndex || m.rowIndex === rowIndex && m.start >= offset) {
        return i;
      }
    }
    return -1;
  }
  function findMatchIndexBefore(matches, rowIndex, offset) {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (m.rowIndex < rowIndex || m.rowIndex === rowIndex && m.start < offset) {
        return i;
      }
    }
    return -1;
  }
  function resolveMatchFromAnchor(matches, anchor, direction) {
    if (!matches.length) {
      return -1;
    }
    if (direction > 0) {
      const idx2 = findMatchIndexAtOrAfter(matches, anchor.rowIndex, anchor.offset ?? 0);
      return idx2 >= 0 ? idx2 : 0;
    }
    const idx = findMatchIndexBefore(matches, anchor.rowIndex, anchor.offset ?? 0);
    return idx >= 0 ? idx : matches.length - 1;
  }
  function computeNextFindIndex(matches, anchor, current, selectedIndex, findNavSynced) {
    let rowIndex;
    let offset;
    if (current && selectedIndex === current.rowIndex && (findNavSynced || compareFindPos(anchor, { rowIndex: current.rowIndex, offset: current.start }) >= 0)) {
      rowIndex = current.rowIndex;
      offset = current.end;
    } else {
      rowIndex = anchor.rowIndex;
      offset = anchor.offset ?? 0;
    }
    const idx = findMatchIndexAtOrAfter(matches, rowIndex, offset);
    return idx >= 0 ? idx : 0;
  }
  function computePrevFindIndex(matches, anchor, current, selectedIndex, findNavSynced) {
    let rowIndex;
    let offset;
    if (current && selectedIndex === current.rowIndex && (findNavSynced || current.rowIndex === anchor.rowIndex && compareFindPos(anchor, { rowIndex: current.rowIndex, offset: current.start }) <= 0)) {
      rowIndex = current.rowIndex;
      offset = current.start;
    } else {
      rowIndex = anchor.rowIndex;
      offset = anchor.offset ?? 0;
    }
    const idx = findMatchIndexBefore(matches, rowIndex, offset);
    return idx >= 0 ? idx : matches.length - 1;
  }
  return __toCommonJS(findNavigation_entry_exports);
})();
//# sourceMappingURL=findNavigation.js.map
