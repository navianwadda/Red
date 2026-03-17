const ORIGIN_BASE = "https://tulnit.fun";
const ORIGIN_STREAM = "https://tulnit.fun/sliv/stream.php?id=1000009248&e=.m3u8";
const REQUIRED_REFERER = "https://tulnit.fun/hot/sliv/play.php?id=978d48bb0639a9271d0b40bd421e4729";
const PLAYLIST_BASE = "https://tulnit.fun/sliv/";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Main clean playlist endpoint
    if (url.pathname === "/sonysab.m3u8") {
      return proxyUrl(ORIGIN_STREAM, PLAYLIST_BASE, url);
    }

    // Segment passthrough
    if (url.pathname === "/proxy-segment") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400 });
      return proxyUrl(decodeURIComponent(target), null, url);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function proxyUrl(originUrl, baseUrl, proxyUrl) {
  let response;
  try {
    response = await fetch(originUrl, {
      headers: upstreamHeaders(),
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

  if (isPlaylist && baseUrl) {
    const text = await response.text();
    if (!text.includes("#EXTM3U")) {
      return new Response(text, {
        status: response.status,
        headers: { "Content-Type": "text/plain", ...corsHeaders() },
      });
    }
    const rewritten = rewriteM3U8(text, baseUrl, proxyUrl);
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
  return new Response(response.body, { status: response.status, headers: newHeaders });
}

function rewriteM3U8(text, baseUrl, proxyUrl) {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") return line;

      const absolute = trimmed.startsWith("http")
        ? trimmed
        : baseUrl + trimmed;

      return `${proxyUrl.origin}/proxy-segment?url=${encodeURIComponent(absolute)}`;
    })
    .join("\n");
}

function upstreamHeaders() {
  return {
    "Referer": REQUIRED_REFERER,
    "Origin": ORIGIN_BASE,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
    "Accept": "*/*",
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  };
}
