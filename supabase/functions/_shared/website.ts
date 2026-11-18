// Fetch a business's website as plain text, so the fix list can say what it's missing.
// Only public http(s) pages are fetched.

const MAX_CHARS = 8000;

export async function fetchWebsiteText(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) return null;

  try {
    const res = await fetch(parsed, {
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "User-Agent": "SpotlightBot/1.0 (website check)", Accept: "text/html" },
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html")) return null;
    const html = (await res.text()).slice(0, 500_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] ?? "";
    const hasSchema = /application\/ld\+json/i.test(html) && /LocalBusiness|Restaurant|Store|Service/i.test(html);
    const body = html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#?\w+;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return [
      `Page title: ${title.trim() || "(none)"}`,
      `Meta description: ${description.trim() || "(none)"}`,
      `Has LocalBusiness structured data: ${hasSchema ? "yes" : "no"}`,
      `Visible text: ${body.slice(0, MAX_CHARS)}`,
    ].join("\n");
  } catch {
    return null;
  }
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.startsWith("[") // IPv6 literals
  );
}
