import shortlinks from '../shortlinks.json' with { type: 'json' };

export const config = { runtime: 'edge' };

export function GET(request) {
  const url = new URL(request.url);
  const code = url.pathname.slice(1).split('/')[0];

  if (!code) {
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://coppersuncreative.com' },
    });
  }

  const entry = shortlinks[code];

  if (!entry?.url) {
    console.warn(`shortlink_miss code=${code} ua=${request.headers.get('user-agent') || 'none'}`);
    return new Response('Short link not found.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return new Response(null, {
    status: 301,
    headers: {
      Location: entry.url,
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
