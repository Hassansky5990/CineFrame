import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedTmdbPath, isAllowedTmdbQueryKey } from '../lib/tmdb-path.js';

test('allows the TMDB endpoints used by CineFrame', () => {
  const allowed = [
    'trending/all/week',
    'movie/popular',
    'movie/top_rated',
    'tv/popular',
    'discover/movie',
    'discover/tv',
    'genre/movie/list',
    'genre/tv/list',
    'search/multi',
    'movie/550',
    'movie/550/release_dates',
    'movie/550/videos',
    'movie/550/recommendations',
    'tv/1399',
    'tv/1399/content_ratings',
    'tv/1399/season/1',
    'tv/1399/videos',
    'tv/1399/recommendations'
  ];
  for (const path of allowed) assert.equal(isAllowedTmdbPath(path), true, path);
});

test('rejects unknown, malformed, and traversal paths', () => {
  const rejected = [
    '',
    '/movie/popular',
    '../configuration',
    'movie/550/../../account',
    'authentication/token',
    'account',
    'search/person',
    'movie/abc',
    'movie/550/unknown',
    'movie//popular',
    'movie/550?append_to_response=videos',
    'x'.repeat(161)
  ];
  for (const path of rejected) assert.equal(isAllowedTmdbPath(path), false, path);
});

test('allows only query parameters required by CineFrame', () => {
  for (const key of ['language', 'region', 'page', 'query', 'include_adult', 'sort_by', 'with_genres', 'with_original_language', 'vote_count.gte', 'primary_release_date.lte', 'first_air_date.lte']) {
    assert.equal(isAllowedTmdbQueryKey(key), true, key);
  }
  for (const key of ['api_key', 'path', 'append_to_response', 'session_id', 'unknown']) {
    assert.equal(isAllowedTmdbQueryKey(key), false, key);
  }
});
