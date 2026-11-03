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

const ALLOWED_QUERY_KEYS = new Set([
  'language',
  'region',
  'page',
  'query',
  'include_adult',
  'sort_by',
  'with_genres',
  'with_original_language',
  'vote_count.gte',
  'primary_release_date.lte',
  'first_air_date.lte'
]);

/**
 * Restrict the public TMDB proxy to endpoints and query parameters
 * CineFrame actually uses. Validate before constructing the upstream URL.
 */
export function isAllowedTmdbPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('..')) {
    return false;
  }
  if (value.length > 160 || !/^[a-zA-Z0-9_/-]+$/.test(value)) return false;
  return ALLOWED_PATHS.some(pattern => pattern.test(value));
}

export function isAllowedTmdbQueryKey(value) {
  return typeof value === 'string' && ALLOWED_QUERY_KEYS.has(value);
}
