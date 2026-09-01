import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { waitUntil } from '@vercel/functions';

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

// ─── Hit logging → Axiom (2026-09-01) ────────────────────────────────────────
// Every resolved redirect is recorded as a structured `shortlink_hit` event so
// the short links become MEASUREMENT, not just uniformity (the whole point of
// shortening 100% of owned links). Two sinks, both best-effort:
//   1. console.log — always; visible in Vercel's own function logs.
//   2. DIRECT Axiom ingest (fetch → Axiom /ingest) — the durable, queryable
//      copy. Deliberately NOT a Vercel Log Drain: drains are metered at
//      $0.50/GB, and a direct POST to Axiom uses only Axiom's (free-tier)
//      ingest, so measurement costs ~nothing. Gated on env vars — absent →
//      ingest is skipped and only the console.log fires (so nothing breaks
//      before Axiom is wired). Delivered via waitUntil so it never delays the
//      redirect, and every failure is swallowed — telemetry must NEVER break a
//      redirect.
//
// bot vs human is the load-bearing field: OG-card crawlers (Bluesky Cardyb,
// Twitterbot, LinkedInBot, Slackbot, …) fetch the short link EVERY time a card
// renders, so without this flag the counts would be almost entirely automated.
// Default no-UA → bot (scripted hits rarely send one; humans' browsers always do).
function isBotUA(ua) {
  if (!ua) return true;
  return /bot|crawl|spider|slurp|preview|fetch|embed|cardyb|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|redditbot|pinterest|applebot|bingbot|googlebot|google-inspectiontool|iframely|curl|wget|python-requests|node-fetch|axios|headless|monitor|uptime/i.test(ua);
}

// Axiom ingest config (set on the Vercel project). AXIOM_API_URL defaults to
// the US endpoint; set it to https://api.eu.axiom.co for an EU Axiom org.
const AXIOM_TOKEN = process.env.AXIOM_TOKEN;
const AXIOM_DATASET = process.env.AXIOM_DATASET;
// Strip a trailing slash so a value like "https://api.eu.axiom.co/" doesn't
// produce a double-slash ingest URL (which Axiom 404s → silent telemetry loss).
const AXIOM_API_URL = (process.env.AXIOM_API_URL || 'https://api.axiom.co').replace(/\/+$/, '');

function ingestHit(record) {
  if (!AXIOM_TOKEN || !AXIOM_DATASET) return; // not wired yet → console.log only
  try {
    const p = fetch(`${AXIOM_API_URL}/v1/datasets/${encodeURIComponent(AXIOM_DATASET)}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AXIOM_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([record]),
    }).catch(() => {}); // network failure must never surface
    waitUntil(p); // finish the POST after the redirect returns, without delaying it
  } catch {
    /* ingest must never break the redirect */
  }
}

function logHit(code, entry, request) {
  try {
    const ua = request.headers.get('user-agent') || '';
    const record = {
      _time: new Date().toISOString(),
      event: 'shortlink_hit',
      code,
      project: entry.project ?? null,
      slug: entry.slug ?? null,
      dest: entry.url,
      bot: isBotUA(ua),
      ua: ua.slice(0, 200) || null,
      referer: request.headers.get('referer') || null,
      country: request.headers.get('x-vercel-ip-country') || null,
    };
    console.log(JSON.stringify(record));
    ingestHit(record);
  } catch {
    /* logging must never break the redirect */
  }
}

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

  logHit(code, entry, request);

  // 302 (temporary), not 301: 301 is browser-cached indefinitely, which makes
  // typo'd shortlinks unfixable. The mapping IS rewritten by the generation
  // pipeline; treat redirects as updatable.
  //
  // No SHARED (CDN) cache — `s-maxage=0`: a shared-edge cache would serve repeat
  // hits WITHOUT invoking this function, so those hits wouldn't be logged (the
  // measurement would undercount, biased by whichever crawler warmed the POP).
  // Recomputing a redirect is an in-memory map lookup — cheap — and dropping the
  // shared cache also makes typo fixes propagate instantly (aligns with the
  // updatable-redirect rationale above). A short browser `max-age` still dedupes
  // one user's rapid re-clicks so they don't each log a hit.
  return new Response(null, {
    status: 302,
    headers: {
      Location: entry.url,
      'Cache-Control': 'public, max-age=30, s-maxage=0',
    },
  });
}
