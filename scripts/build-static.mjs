/* Assemble the static site for Vercel.

   The app is a dependency-free front end that lives in market-terminal/. On
   Vercel we serve it as plain static files: this script copies index.html and
   assets/ into public/, which vercel.json declares as the output directory.

   market-terminal/server/ is only a local convenience host (static files plus
   an optional keyed-data proxy) and is not required in production — the front
   end talks to Deriv's public API directly over WebSocket from the browser.
*/
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'market-terminal');
const out = resolve(root, 'public');

const ENTRIES = ['index.html', 'assets'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

let copied = 0;
for (const entry of ENTRIES) {
  const from = resolve(src, entry);
  if (!existsSync(from)) continue;
  await cp(from, resolve(out, entry), { recursive: true });
  copied += 1;
}

if (!existsSync(resolve(out, 'index.html'))) {
  console.error('build-static: market-terminal/index.html is missing');
  process.exit(1);
}

console.log(`build-static: assembled ${copied} entries into public/`);
