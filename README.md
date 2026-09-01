# Brass Shortener (brss.fyi)

Tiny URL shortener serving Brass-SEO, BrassTranscripts, and CopperSun.io social posts.

- **Live:** https://brss.fyi/{code}
- **Stack:** single Vercel Node.js Function (Fluid Compute) + a JSON mapping table. No database, no Next.js; one dependency (`@vercel/functions`, for `waitUntil` on the hit-ingest path).

## How it works

1. Generation pipeline (in `19-Brass-SEO/scripts/generate-social-draft.mjs`) computes a deterministic 4-char base36 code for each `(project, slug)` pair.
2. The pipeline writes the mapping into `shortlinks.json` in this repo and commits it.
3. This deployment serves `https://brss.fyi/{code}` — loads the JSON at module init, 302-redirects to the long URL.
4. Cache headers: `public, max-age=30, s-maxage=0`. 302 (not 301) is intentional — 301s are browser-cached indefinitely, making typo'd shortlinks impossible to repoint. Use 302 to keep mappings updatable. **No shared/CDN cache (`s-maxage=0`)** so every distinct hit invokes the function and is logged (see Hit logging) and typo fixes propagate instantly; the short browser `max-age=30` just dedupes one user's rapid re-clicks.

## Files

| File | Purpose |
|---|---|
| `api/[code].js` | The redirect function (Node.js runtime) + Axiom hit-ingest |
| `shortlinks.json` | Code → `{project, slug, url}` mapping. Updated by the generation pipeline. |
| `vercel.json` | Rewrite `/{code}` to `/api/{code}` |
| `package.json` | ESM module config; one dep (`@vercel/functions`) |

## Adding entries

Don't hand-edit `shortlinks.json`. The generation pipeline manages it. New posts get codes automatically when drafted.

To add an entry manually (one-off):

```json
{
  "abc": {
    "project": "brass-seo",
    "slug": "example-post",
    "url": "https://brass-seo.com/blog/example-post"
  }
}
```

Then commit and push — Vercel auto-deploys.

## Hit logging (attribution)

Every resolved redirect records one structured `shortlink_hit` event:

```json
{"_time":"2026-09-01T18:34:24Z","event":"shortlink_hit","code":"bnw4","project":"brass-seo",
 "slug":"10-questions-seo-data","dest":"https://brass-seo.com/blog/10-questions-seo-data",
 "bot":false,"ua":"Mozilla/5.0 …","referer":null,"country":"US"}
```

This is what makes shortening 100% of owned links earn its keep — the short link
is now MEASUREMENT, not just uniformity. Query which posts/pages actually get
clicked, split by project and human-vs-bot.

**Two sinks, both best-effort (a failure NEVER breaks a redirect):**

1. **`console.log`** — always on; visible in Vercel's own function logs (short retention).
2. **Direct Axiom ingest** — a `fetch` POST straight to Axiom's `/ingest` API,
   delivered via `waitUntil` so it never delays the redirect. This is
   **deliberately NOT a Vercel Log Drain**: drains are metered at **$0.50/GB**,
   whereas a direct POST uses only Axiom's (free-tier) ingest, so measurement
   costs ~nothing. Gated on env vars — until they're set, ingest is skipped and
   only the `console.log` fires.

**Config (Vercel project → Settings → Environment Variables):**

| Var | Value |
|---|---|
| `AXIOM_TOKEN` | an Axiom **API token** with ingest rights (starts `xaat-`) |
| `AXIOM_DATASET` | the dataset name, e.g. `brass-shortener` |
| `AXIOM_API_URL` | *(optional)* `https://api.eu.axiom.co` for an EU Axiom org; defaults to US |

Then query in Axiom: `['brass-shortener'] | where event == "shortlink_hit" and bot == false`.

- **`bot` is the load-bearing field.** OG-card crawlers (Bluesky `Cardyb`,
  `Twitterbot`, `LinkedInBot`, `Slackbot`, …) fetch the short link *every time a
  card renders*, so most raw hits are automated. Filter `bot == false` for real
  clicks. Classification is a user-agent heuristic (`isBotUA`); no-UA → bot.
- **Caveat:** counts are a slight lower bound — the 30 s browser cache means one
  user's immediate re-click isn't re-logged. The shared/CDN cache is OFF, so
  cross-user hits are not swallowed.

## 404 logging

Misses are logged via `console.warn` (`shortlink_miss`) and visible in Vercel
function logs. If a code 404s repeatedly, check the generation pipeline didn't
drop the mapping or the deploy is stale.

## Deployment

Linked to Vercel project. Custom domain `brss.fyi` configured in the Vercel UI. Auto-deploys on push to `main`.
