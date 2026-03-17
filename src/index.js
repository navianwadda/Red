const ORIGIN_BASE = "https://tulnit.fun";
const REQUIRED_REFERER = "https://tulnit.fun/hot/sliv/play.php?id=978d48bb0639a9271d0b40bd421e4729";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Debug endpoint — visit /debug to verify worker is alive and see what origin returns
    if (url.pathname === "/debug") {
      const testUrl = ORIGIN_BASE + "/sliv/stream.php?id=1000009248&e=.m3u8";
      let status, body, ct;
      try {
        const r = await fetch(testUrl, {
          headers: {
            "Referer": REQUIRED_REFERER,
            "Origin": ORIGIN_BASE,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
            "Accept": "*/*",
          },
          redirect: "follow",
        });
        status = r.status;
        ct = r.headers.get("content-type");
        body = await r.text();
      } catch (e) {
        body = "fetch error: " + e.message;
        status = 0;
      }
      return new Response(
        JSON.stringify({ status, contentType: ct, body: body.slice(0, 2000) }, null, 2),
        { headers: { "Content-Type": "application/json", ...corsHeaders() } }
      );
    }

    // Segment passthrough for rewritten m3u8 lines
    if (url.pathname === "/proxy-segment") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400 });
      return proxyUrl(decodeURIComponent(target), url);
    }

    // Pass full raw URL path+search to origin, preserving special chars
    // Use request.url to extract everything after the worker domain
    const afterDomain = request.url.slice(url.origin.length); // e.g. /sliv/stream.php?id=...&e=.m3u8
    const originUrl = ORIGIN_BASE + afterDomain;

    return proxyUrl(originUrl, url);
  },
};

async function proxyUrl(originUrl, proxyUrl) {
  let response;
  try {
    response = await fetch(originUrl, {
      headers: {
        "Referer": REQUIRED_REFERER,
        "Origin": ORIGIN_BASE,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "Accept": "*/*",
      },
      redirect: "follow",
    });
  } catch (err) {
    return new Response("Upstream error: " + err.message, { status: 502 });
  }

  const contentType = response.headers.get("content-type") || "";
  const isPlaylist =
    originUrl.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegurl") ||
    contentType.includes("text/plain");

  if (isPlaylist) {
    const text = await response.text();
    // If it's actually a redirect or error page, return as-is for debugging
    if (!text.includes("#EXTM3U") && response.status !== 200) {
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "text/plain", ...corsHeaders() },
      });
    }
    const rewritten = rewriteM3U8(text, proxyUrl);
    return new Response(rewritten, {
      status: response.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-cache",
      },
    });
  }

  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => newHeaders.set(k, v));

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders,
  });
}

function rewriteM3U8(text, proxyUrl) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") return line;

      const absolute = trimmed.startsWith("http")
        ? trimmed
        : ORIGIN_BASE + "/" + trimmed.replace(/^\//, "");

      return `${proxyUrl.origin}/proxy-segment?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  };
}
