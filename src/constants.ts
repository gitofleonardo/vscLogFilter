/** Worker message batch size (lines). Parsing implementation detail. */
export const WORKER_CHUNK_LINES = 5000;

/** Tag names included in webview autocomplete payloads. */
export const TAG_SUGGESTION_LIMIT = 100;

/** Header lines sampled when detecting logcat format. */
export const LOGCAT_DETECT_SAMPLE_LINES = 50;

/** Max find-in-results hits returned from the worker in one pass. */
export const MAX_FIND_MATCHES = 10_000;

/** Max saved filter queries kept in globalState. */
export const MAX_SAVED_QUERIES = 50;

/** globalState key for saved filter queries. */
export const SAVED_QUERIES_KEY = 'logFilter.savedQueries';

/** How often (entries) the filter loop considers emitting determinate progress. Power of two. */
export const FILTER_PROGRESS_CHECK_EVERY = 4096;

/** Minimum interval between filter progress messages from the worker. */
export const FILTER_PROGRESS_INTERVAL_MS = 100;

