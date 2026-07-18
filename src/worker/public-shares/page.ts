function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

const pageHeaders = {
  "Cache-Control": "no-store, private",
  "Content-Security-Policy":
    "default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const

export function publicSharePage({
  token,
  title,
  blurb,
}: {
  token: string
  title: string
  blurb: string
}) {
  const encodedToken = encodeURIComponent(token)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: Canvas; color: CanvasText; }
    header { display: flex; align-items: center; gap: 1rem; min-height: 4rem; padding: .75rem 1rem; border-bottom: 1px solid color-mix(in srgb, CanvasText 18%, transparent); }
    .summary { min-width: 0; flex: 1; }
    h1 { overflow: hidden; margin: 0; font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
    p { overflow: hidden; margin: .2rem 0 0; color: color-mix(in srgb, CanvasText 68%, transparent); font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }
    a { flex: none; border: 1px solid color-mix(in srgb, CanvasText 24%, transparent); padding: .55rem .8rem; color: CanvasText; font-size: .85rem; font-weight: 600; text-decoration: none; }
    a:hover { background: color-mix(in srgb, CanvasText 8%, transparent); }
    main { height: calc(100vh - 4rem); padding: .75rem; background: color-mix(in srgb, CanvasText 4%, Canvas); }
    iframe { width: 100%; height: 100%; border: 1px solid color-mix(in srgb, CanvasText 18%, transparent); background: white; }
  </style>
</head>
<body>
  <header>
    <div class="summary">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(blurb)}</p>
    </div>
    <a href="/share/${encodedToken}/download" download>Download HTML</a>
  </header>
  <main>
    <iframe src="/share/${encodedToken}/content" title="${escapeHtml(title)}" sandbox="allow-scripts"></iframe>
  </main>
</body>
</html>`
}

export function publicSharePageResponse(input: Parameters<typeof publicSharePage>[0]) {
  return new Response(publicSharePage(input), { headers: pageHeaders })
}

export function publicShareUnavailableResponse() {
  return new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share unavailable</title><body><main><h1>Share unavailable</h1><p>This link has expired or been taken offline.</p></main></body></html>',
    { status: 404, headers: pageHeaders },
  )
}
