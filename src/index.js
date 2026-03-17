const ORIGIN_BASE = "https://tulnit.fun";
const REQUIRED_REFERER = "https://tulnit.fun/hot/sliv/play.php?id=978d48bb0639a9271d0b40bd421e4729";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // /proxy-segment?url=... — for rewritten m3u8 segment URLs
    if (url.pathname === "/proxy-segment") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400 });
      return proxyUrl(target, request);
    }

    // Everything else: forward to origin
    const originUrl = ORIGIN_BASE + url.pathname + url.search;
    return proxyUrl(originUrl, request);
  },
};

async function proxyUrl(originUrl, request) {
  const url = new URL(request.url);

  const originRequest = new Request(originUrl, {
    method: request.method,
    headers: buildHeaders(request),
    redirect: "follow",
  });

  let response;
  try {
    response = await fetch(originRequest);
  } catch (err) {
    return new Response("Upstream error: " + err.message, { status: 502 });
  }

  const contentType = response.headers.get("content-type") || "";
  const isPlaylist =
    originUrl.includes(".m3u8") ||
    contentType.includes("mpegurl") ||
    contentType.includes("x-mpegurl");

  if (isPlaylist) {
    const text = await response.text();
    const rewritten = rewriteM3U8(text, url);
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
  newHeaders.set("Cache-Control", "public, max-age=10");

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

function buildHeaders(request) {
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (["accept", "accept-encoding", "accept-language", "range", "user-agent"].includes(key.toLowerCase())) {
      headers.set(key, value);
    }
  }
  headers.set("Referer", REQUIRED_REFERER);
  headers.set("Origin", ORIGIN_BASE);
  return headers;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range",
  };
}
