const ALLOWED_PATHS = [
  /^trending\/all\/week$/,
  /^movie\/(?:popular|top_rated)$/,
  /^tv\/popular$/,
  /^discover\/(?:movie|tv)$/,
  /^genre\/(?:movie|tv)\/list$/,
  /^search\/multi$/,
  /^movie\/\d+(?:\/(?:release_dates|videos|recommendations))?$/,
  /^tv\/\d+(?:\/(?:content_ratings|videos|recommendations|season\/\d+))?$/
];

/**
 * Restrict the public TMDB proxy to endpoints CineFrame actually uses.
 * The path is intentionally checked before it is joined to the upstream URL.
 */
export function isAllowedTmdbPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('..')) {
    return false;
  }
  if (value.length > 160 || !/^[a-zA-Z0-9_/-]+$/.test(value)) return false;
  return ALLOWED_PATHS.some(pattern => pattern.test(value));
}
