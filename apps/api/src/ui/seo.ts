export const SITE_URL = process.env.SITE_URL ?? "https://neverasktwice.dev";
export const SITE_NAME = "Never Ask Twice";
export const SITE_TAGLINE = "Support that remembers.";
export const SITE_DESCRIPTION =
  "Support that remembers: an enterprise MemoryAgent with auditable customer context — provenance, expiry, and supersession, not just recall. Built on Qwen Cloud for the Qwen Cloud Global AI Hackathon.";
export const OG_IMAGE_URL = `${SITE_URL}/static/brand/og-image.png`;

interface SeoHeadOptions {
  title: string;
  description?: string;
  path: string;
  ogType?: "website" | "article";
  index?: boolean;
}

/**
 * Renders the meta/OG/Twitter/canonical/JSON-LD block for a page. Injected
 * server-side rather than baked into templates so both the bundled landing
 * page and the hand-rolled chat view share one source of truth.
 */
function escAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function seoHeadTags({
  title,
  description = SITE_DESCRIPTION,
  path,
  ogType = "website",
  index = true,
}: SeoHeadOptions): string {
  const canonical = `${SITE_URL}${path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description,
    url: canonical,
    image: OG_IMAGE_URL,
    author: {
      "@type": "Person",
      name: "Qwynn Marcelle",
      url: "https://marcellelabs.io/technical-cofounder",
    },
  };

  const escTitle = escAttr(title);
  const escDesc = escAttr(description);
  const escCanonical = escAttr(canonical);

  return `
  <meta name="description" content="${escDesc}">
  <link rel="canonical" href="${escCanonical}">
  <meta name="robots" content="${index ? "index, follow" : "noindex, nofollow"}">
  <meta property="og:type" content="${ogType}">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${escTitle}">
  <meta property="og:description" content="${escDesc}">
  <meta property="og:url" content="${escCanonical}">
  <meta property="og:image" content="${OG_IMAGE_URL}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escTitle}">
  <meta name="twitter:description" content="${escDesc}">
  <meta name="twitter:image" content="${OG_IMAGE_URL}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}
