export { FakeQwenClient } from "../src/testing/fakeQwenClient.js";

/** Hono's `fetch` may answer synchronously, so the helpers accept either. */
export type FetchLike = { fetch: (req: Request) => Response | Promise<Response> };

/**
 * The `nat_visitor` cookie is `<uuid>.<hmac>`; the tenant key is derived from
 * the uuid alone. Tests send the whole signed value back as the cookie and use
 * this to name the tenant it maps to.
 */
export function visitorTenant(cookieValue: string): string {
  const separator = cookieValue.lastIndexOf(".");
  return `visitor_${separator > 0 ? cookieValue.slice(0, separator) : cookieValue}`;
}

/** Extracts the full signed cookie value from a Set-Cookie header. */
export function parseVisitorCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/nat_visitor=([^;]+)/);
  return match ? match[1] : null;
}

/**
 * Loads /chat to obtain a real signed visitor cookie and its seeded facts —
 * the same path a browser takes before any WebMCP tool can be called.
 */
export async function newVisitor(app: FetchLike): Promise<{
  cookie: string;
  tenant: string;
}> {
  const res = await app.fetch(new Request("http://localhost/chat"));
  const cookie = parseVisitorCookie(res.headers.get("set-cookie"));
  if (!cookie) throw new Error("expected /chat to mint a visitor cookie");
  return { cookie, tenant: visitorTenant(cookie) };
}
