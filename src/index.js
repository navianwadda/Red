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

    if (url.pathname === "/sonysab.m3u8") {
      return proxyPlaylist(ORIGIN_STREAM, PLAYLIST_BASE, url);
    }

    if (url.pathname === "/proxy-segment") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400 });
      return proxySegment(decodeURIComponent(target));
    }

    return new Response("Not found", { status: 404 });
  },
};

async function proxyPlaylist(originUrl, baseUrl, proxyUrl) {
  let response;
  try {
    response = await fetch(originUrl, {
      headers: {
        "Referer": REQUIRED_REFERER,
        "Origin": ORIGIN_BASE,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Encoding": "identity", // no compression so text() works correctly
      },
      redirect: "follow",
    });
  } catch (err) {
    return new Response("Upstream error: " + err.message, { status: 502 });
  }

  const text = await response.text();

  if (!text.includes("#EXTM3U")) {
    // Return raw for debugging
    return new Response("Origin did not return valid m3u8:\n\n" + text, {
      status: 502,
      headers: { "Content-Type": "text/plain", ...corsHeaders() },
    });
  }

  const rewritten = rewriteM3U8(text, baseUrl, proxyUrl);

  return new Response(rewritten, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-cache",
    },
  });
}

async function proxySegment(originUrl) {
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
    return new Response("Segment fetch error: " + err.message, { status: 502 });
  }

  const newHeaders = new Headers(response.headers);
  Object.entries(corsHeaders()).forEach(([k, v]) => newHeaders.set(k, v));

  // If segment is itself a playlist (sub-rendition), rewrite it too
  const ct = response.headers.get("content-type") || "";
  if (ct.includes("mpegurl") || originUrl.includes(".m3u8")) {
    const text = await response.text();
    const base = originUrl.substring(0, originUrl.lastIndexOf("/") + 1);
    // We need proxyUrl origin — derive from the segment URL structure
    // Since we're inside a worker, use a placeholder and replace
    const rewritten = rewriteM3U8Sub(text, base);
    newHeaders.set("Content-Type", "application/vnd.apple.mpegurl");
    newHeaders.set("Cache-Control", "no-cache");
    return new Response(rewritten, { status: 200, headers: newHeaders });
  }

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

// For sub-playlists (rendition m3u8s) fetched via /proxy-segment
function rewriteM3U8Sub(text, baseUrl) {
  // We'll use a relative approach — point segments back through proxy-segment
  // proxyOrigin is inferred from the Referer-like context; hardcode worker domain
  // This will be fixed once we know the worker URL — for now passthrough absolute URLs
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || trimmed === "") return line;

      const absolute = trimmed.startsWith("http")
        ? trimmed
        : baseUrl + trimmed;

      return absolute; // segments in sub-playlists go directly (no CORS issue for .ts)
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
