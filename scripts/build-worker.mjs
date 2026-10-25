import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

async function filesIn(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...(await filesIn(path)));
    else if (entry.name !== "sw.js") result.push(path);
  }
  return result.sort();
}

const files = await filesIn("dist");
const hash = createHash("sha256");
for (const file of files) {
  hash.update(file);
  hash.update(await readFile(file));
}
const cache = `vegetate-${hash.digest("hex").slice(0, 16)}`;
const assets = ["/", ...files.map((file) => file.slice(4))];

await writeFile(
  "dist/sw.js",
  `const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('vegetate-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin || new URL(request.url).pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE).then(cache => cache.match('/', { ignoreVary: true }))));
  } else if (ASSETS.includes(new URL(request.url).pathname)) {
    // These are same-origin, immutable build assets; Origin does not change their contents.
    event.respondWith(caches.open(CACHE).then(cache => cache.match(request, { ignoreVary: true }).then(hit => hit || fetch(request))));
  }
});
`,
);
console.log(`Offline worker generated: ${assets.length} assets, ${cache}`);
