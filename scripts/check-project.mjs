import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
if (!packageJson.scripts?.start) {
  throw new Error('package.json must define a start script.');
}

const html = readFileSync('index.html', 'utf8');
const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const inlineScripts = scriptTags.filter(([, attributes]) => {
  if (/\bsrc\s*=/i.test(attributes)) return false;
  const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
  return !type || /^(text|application)\/(javascript|ecmascript)$/i.test(type);
});

if (inlineScripts.length === 0) {
  throw new Error('No inline JavaScript block was found in index.html.');
}

inlineScripts.forEach(([, , source], index) => {
  new Script(source, { filename: \`index.html:inline-script-\${index + 1}.js\` });
});

console.log(\`CineFrame checks passed: package.json, server.js, and \${inlineScripts.length} inline script block(s).\`);
