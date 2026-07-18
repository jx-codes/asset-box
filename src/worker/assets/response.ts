export function assetHtmlResponse({
  body,
  cacheControl,
  disposition,
  filename,
}: {
  body: ReadableStream
  cacheControl: string
  disposition: "inline" | "attachment"
  filename: string
}) {
  return new Response(body, {
    headers: {
      "Cache-Control": cacheControl,
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Content-Security-Policy":
        "sandbox allow-scripts; default-src * data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  })
}
