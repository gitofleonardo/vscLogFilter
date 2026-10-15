/** Inline SVG icons for the live capture toolbar (uses currentColor). */

const svgWrap = (body: string) =>
  `<svg class="capture-svg" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

/** Document — open current capture log in editor. */
export const captureIconOpenLog = svgWrap(`
  <path fill="currentColor" fill-rule="evenodd" d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6H9V1zm1 5h3.3L10 2.7V6zM4 2h4v4a1 1 0 0 0 1 1h4v7H4V2z"/>
`);

/** Document with plus — new capture file. */
export const captureIconNewFile = svgWrap(`
  <path fill="currentColor" fill-rule="evenodd" d="M9 1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6H9V1zm1 5h3.3L10 2.7V6zM4 2h4v4a1 1 0 0 0 1 1h4v7H4V2zm4 6.5a.75.75 0 0 1 .75.75V10h1.25a.75.75 0 0 1 0 1.5H8.75v1.25a.75.75 0 0 1-1.5 0V11.5H6a.75.75 0 0 1 0-1.5h1.25V9.25A.75.75 0 0 1 8 8.5z"/>
`);

/** Trash — clear device logcat buffer before start. */
export const captureIconClearBuffer = svgWrap(`
  <path fill="currentColor" fill-rule="evenodd" d="M5 2h6v1H5V2zm-1 2h8l-.75 8.25A1.25 1.25 0 0 1 10 13.5H6a1.25 1.25 0 0 1-1.24-1.25L4 4zm2.1 2v5.8h1.4V6H6.1zm3.4 0v5.8h1.4V6h-1.4z"/>
`);

/** Filled dot in ring — start recording. */
export const captureIconRecord = svgWrap(`
  <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.25"/>
  <circle cx="8" cy="8" r="2.75" fill="currentColor"/>
`);

/** Stop square — end recording. */
export const captureIconStop = svgWrap(`
  <rect x="5" y="5" width="6" height="6" rx="1" fill="currentColor"/>
`);
