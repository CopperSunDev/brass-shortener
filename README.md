# Brass Shortener (brss.fyi)

Tiny URL shortener serving Brass-SEO, BrassTranscripts, and CopperSun.io social posts.

- **Live:** https://brss.fyi/{code}
- **Stack:** single Vercel Edge Function + a JSON mapping table. No database, no Next.js, no dependencies.

## How it works

1. Generation pipeline (in `19-Brass-SEO/scripts/generate-social-draft.mjs`) computes a deterministic 4-char base36 code for each `(project, slug)` pair.
2. The pipeline writes the mapping into `shortlinks.json` in this repo and commits it.
3. This deployment serves `https://brss.fyi/{code}` — reads the JSON at build time, 301-redirects to the long URL.
4. Cache headers: `public, max-age=300, s-maxage=300` (5 min) — short links are stable, but new entries roll out within 5 minutes of deploy.

## Files

| File | Purpose |
|---|---|
| `api/[code].js` | The redirect function (Edge runtime) |
| `shortlinks.json` | Code → `{project, slug, url}` mapping. Updated by the generation pipeline. |
| `vercel.json` | Rewrite `/{code}` to `/api/{code}` |
| `package.json` | ESM module config, no deps |

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

## 404 logging

Misses are logged via `console.warn` and visible in Vercel function logs. If a code 404s repeatedly, check the generation pipeline didn't drop the mapping or the deploy is stale.

## Deployment

Linked to Vercel project. Custom domain `brss.fyi` configured in the Vercel UI. Auto-deploys on push to `main`.
