import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load + validate the mapping at cold start. If parsing fails, fall back to an
// empty map so misses 404 cleanly instead of crashing every request with 500.
// If a single entry has a malformed url, drop just that entry — the rest stay live.
const shortlinks = (() => {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(__dirname, '..', 'shortlinks.json'), 'utf8'));
  } catch (err) {
    console.error(`shortlinks_load_failed: ${err.message}`);
    return {};
  }
  const valid = {};
  for (const [code, entry] of Object.entries(raw)) {
    try {
      new URL(entry?.url);
      valid[code] = entry;
    } catch {
      console.warn(`shortlinks_invalid_url code=${code} url=${entry?.url}`);
    }
  }
  return valid;
})();

// Paths Vercel routes here that aren't real shortlink lookups (browsers request
// /favicon.ico automatically, robots crawl /robots.txt, etc.). Silent 404 keeps
// real misses signal-clean in logs.
const SILENT_404 = new Set([
  'favicon.ico',
  'robots.txt',
  'sitemap.xml',
  'apple-touch-icon.png',
  'apple-touch-icon-precomposed.png',
  '.well-known',
]);

export function GET(request) {
  const url = new URL(request.url);
  // Strip leading slash, drop any trailing slash. Reject multi-segment paths
  // explicitly — codes are always a single segment.
  const code = url.pathname.slice(1).replace(/\/$/, '');

  if (!code) {
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://coppersuncreative.com' },
    });
  }

  if (code.includes('/')) {
    return new Response('Short link not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  if (SILENT_404.has(code)) {
    return new Response(null, { status: 404 });
  }

  const entry = shortlinks[code];

  if (!entry?.url) {
    console.warn(`shortlink_miss code=${code} ua=${request.headers.get('user-agent') || 'none'}`);
    return new Response('Short link not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // 302 (temporary), not 301: 301 is browser-cached indefinitely, which makes
  // typo'd shortlinks unfixable. The mapping IS rewritten by the generation
  // pipeline; treat redirects as updatable.
  return new Response(null, {
    status: 302,
    headers: {
      Location: entry.url,
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
