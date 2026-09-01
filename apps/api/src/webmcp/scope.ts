import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import type { Context } from "hono";

/**
 * Tenant-scope primitives for the browser-facing surface.
 *
 * G1 established that the model cannot *name* a tenant: `get_support_context`
 * takes topics only. That is necessary but not sufficient. The tenant selector
 * is still a value the browser carries, so the boundary is only as strong as
 * that value's integrity. Before this module the visitor cookie was a bare
 * UUID interpolated straight into `visitor_${cookie}`: any string at all became
 * a tenant, and any leaked or guessed identifier could be replayed as one.
 *
 * So the selector is authenticated. `nat_visitor` is now `<uuid>.<hmac>` and a
 * value that does not verify is treated as absent, never as a tenant. That is
 * what makes the scope *mechanically* tenant-bound rather than bound by
 * convention: forging another visitor's scope requires the server's key, not
 * knowledge of their id.
 */

const VISITOR_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Signing key. In production this must be set so cookies survive a restart and
 * are consistent across instances; without it each process mints its own key,
 * which fails closed (old cookies stop verifying and the visitor is treated as
 * new) rather than falling back to unauthenticated scope.
 */
function resolveSecret(): Buffer {
  const configured = process.env.NAT_VISITOR_SECRET;
  if (configured && configured.length >= 16) return Buffer.from(configured, "utf8");
  if (configured) {
    console.warn(
      "[scope] NAT_VISITOR_SECRET is shorter than 16 characters — ignoring it and using an ephemeral key.",
    );
  } else {
    console.warn(
      "[scope] NAT_VISITOR_SECRET is not set — using an ephemeral per-process key. " +
        "Visitor scope will not survive a restart. Set it in any deployed environment.",
    );
  }
  return randomBytes(32);
}

const SECRET = resolveSecret();

function sign(visitorId: string): string {
  return createHmac("sha256", SECRET).update(visitorId).digest("base64url");
}

/** Constant-time comparison that tolerates length mismatch without throwing. */
function signaturesMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Mints a fresh authenticated visitor identity. */
export function mintVisitorCookie(): { visitorId: string; cookieValue: string } {
  const visitorId = randomUUID();
  return { visitorId, cookieValue: `${visitorId}.${sign(visitorId)}` };
}

/**
 * Recovers the visitor id from a cookie value, or null if the value is absent,
 * malformed, or not signed by this server. Callers must treat null as "no
 * visitor" — never as a tenant, and never by echoing the rejected value back.
 */
export function verifyVisitorCookie(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const separator = cookieValue.lastIndexOf(".");
  if (separator <= 0) return null;
  const visitorId = cookieValue.slice(0, separator);
  const signature = cookieValue.slice(separator + 1);
  if (!VISITOR_ID_PATTERN.test(visitorId)) return null;
  if (signature.length === 0) return null;
  if (!signaturesMatch(sign(visitorId), signature)) return null;
  return visitorId;
}

/** The one place a visitor id becomes a store tenant key. */
export function tenantForVisitor(visitorId: string): { accountId: string; customerId: string } {
  return { accountId: `visitor_${visitorId}`, customerId: `visitor_${visitorId}` };
}

// ---------------------------------------------------------------------------
// Origin enforcement
// ---------------------------------------------------------------------------

export type OriginVerdict = { ok: true } | { ok: false; error: string };

const CROSS_ORIGIN_ERROR = "Cross-origin requests are not permitted.";
const MISSING_ORIGIN_ERROR = "This request must be made from the site itself.";

function requestHost(c: Context): string | null {
  const header = c.req.header("host");
  if (header) return header;
  try {
    return new URL(c.req.url).host;
  } catch {
    return null;
  }
}

/**
 * Same-origin enforcement for browser-facing routes.
 *
 * `mode: "read"` rejects a request that positively declares a different origin.
 * `mode: "mutation"` additionally *requires* that declaration: a browser always
 * attaches `Origin` to a cross-origin write, so a write arriving without one
 * cannot be shown to be same-origin and is refused. G4's escalation-contact
 * write is the reason this mode exists ahead of a mutation to use it.
 */
export function enforceSameOrigin(c: Context, mode: "read" | "mutation"): OriginVerdict {
  // Set by the browser, not by page script. `cross-site` and `same-site` are
  // both refused: a sibling subdomain is not this origin.
  const fetchSite = c.req.header("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, error: CROSS_ORIGIN_ERROR };
  }

  const origin = c.req.header("origin");
  if (!origin) {
    // A browser attaches `Origin` to every write, so a mutation wants positive
    // evidence of same-origin rather than mere absence of contrary evidence.
    // `Sec-Fetch-Site` supplies that evidence too, and is accepted so the write
    // path does not break behind a proxy that strips `Origin`: `same-origin` is
    // the browser's own attestation, `none` is a direct navigation.
    if (mode === "mutation" && fetchSite !== "none" && fetchSite !== "same-origin") {
      return { ok: false, error: MISSING_ORIGIN_ERROR };
    }
    return { ok: true };
  }

  const host = requestHost(c);
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return { ok: false, error: CROSS_ORIGIN_ERROR };
  }
  if (!host || originHost !== host) {
    return { ok: false, error: CROSS_ORIGIN_ERROR };
  }
  return { ok: true };
}

/**
 * True when the request carries browser-attributable markers. Such a request
 * may not select a tenant by argument: its scope comes from the signed cookie
 * or it is refused. A caller with direct network access is the trusted API
 * surface and is unaffected — it is outside the browser security model, and
 * bounded instead by not being reachable cross-origin (no wildcard CORS) and
 * by the page never learning a tenant id to replay.
 */
export function isBrowserOriginated(c: Context): boolean {
  return Boolean(
    c.req.header("origin") ??
      c.req.header("sec-fetch-site") ??
      c.req.header("sec-fetch-mode") ??
      c.req.header("cookie"),
  );
}
