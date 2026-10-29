import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
  .filter(match => !/\bsrc\s*=/.test(match[1]) && match[2].trim());

assert.ok(inlineScripts.length > 0, 'index.html should contain the app JavaScript');
inlineScripts.forEach((match, index) => {
  new vm.Script(match[2], { filename: 'index.html:inline-script-' + (index + 1) });
});

for (const feature of [
  'cineframe_watchlist',
  'cineframe_history',
  'scheduleCloudSync',
  'loadPersonalized',
  'startSearch',
  'handlePlayerMessage',
  'renderCardProgress',
  'showCaptionHelp',
  'accountAction'
]) {
  assert.ok(html.includes(feature), 'Missing expected CineFrame feature: ' + feature);
}

const server = await readFile(new URL('../server.cjs', import.meta.url), 'utf8');
new vm.Script(server, { filename: 'server.cjs' });
for (const route of ['/api/app-config', '/api/tmdb/*', '/api/health']) {
  assert.ok(server.includes(route), 'Missing local server route: ' + route);
}

console.log('CineFrame source checks passed (' + inlineScripts.length + ' inline script blocks parsed).');
