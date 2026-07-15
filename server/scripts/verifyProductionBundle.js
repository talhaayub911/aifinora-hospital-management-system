import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const examplePath = path.join(root, '.env.example');
const distPath = path.join(root, 'dist');

if (!existsSync(distPath)) {
  console.error('Production bundle is missing. Run `npm run build` first.');
  process.exit(1);
}

const publicDemoCredentials = readFileSync(examplePath, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.match(/^(VITE_DEMO_.*(?:EMAIL|PASSWORD))=(.+)$/))
  .filter(Boolean)
  .map((match) => ({ key: match[1], value: match[2].trim() }))
  .filter(({ value }) => value);

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    return statSync(entry).isDirectory() ? filesUnder(entry) : [entry];
  });
}

const matches = [];
for (const file of filesUnder(distPath)) {
  const content = readFileSync(file);
  for (const credential of publicDemoCredentials) {
    if (content.includes(Buffer.from(credential.value))) matches.push(`${credential.key} in ${path.relative(root, file)}`);
  }
}

if (matches.length) {
  console.error('Production bundle contains opt-in demonstration credentials:');
  matches.forEach((match) => console.error(`- ${match}`));
  process.exit(1);
}

console.log(`Production bundle credential scan passed (${publicDemoCredentials.length} configured values checked).`);
