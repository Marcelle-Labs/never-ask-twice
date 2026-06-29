export const BRAND_COLORS = {
  charcoal: "#303030",
  gray: "#8A8F98",
  green: "#4ADE80",
} as const;

export const brandMarkSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" role="img" aria-labelledby="nat-mark-title nat-mark-desc">
  <title id="nat-mark-title">Never Ask Twice</title>
  <desc id="nat-mark-desc">Two conversation paths converging into one remembered path forward.</desc>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28 40 C28 25 38 22 52 22 H102 C132 22 139 57 170 66" stroke="#303030" stroke-width="14"/>
    <path d="M28 100 C28 115 38 118 52 118 H102 C132 118 139 83 170 74" stroke="#8A8F98" stroke-width="14"/>
    <path d="M156 70 H212" stroke="#4ADE80" stroke-width="16"/>
    <path d="M188 42 L214 70 L188 98" stroke="#4ADE80" stroke-width="16"/>
  </g>
</svg>`;

export const brandFaviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Never Ask Twice">
  <rect width="64" height="64" rx="14" fill="#ffffff"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 21 C10 14 15 12 22 12 H31 C42 12 43 28 50 30" stroke="#303030" stroke-width="6"/>
    <path d="M10 43 C10 50 15 52 22 52 H31 C42 52 43 36 50 34" stroke="#8A8F98" stroke-width="6"/>
    <path d="M43 32 H57" stroke="#4ADE80" stroke-width="7"/>
    <path d="M50 23 L58 32 L50 41" stroke="#4ADE80" stroke-width="7"/>
  </g>
</svg>`;

export function BrandLockup({ compact = false }: { compact?: boolean } = {}) {
  return `
    <a class="brand-lockup ${compact ? "brand-lockup-compact" : ""}" href="/chat" aria-label="Never Ask Twice home">
      <span class="brand-mark" aria-hidden="true">${brandMarkSvg}</span>
      <span class="brand-text">
        <span class="brand-name">Never Ask Twice</span>
        <span class="brand-descriptor">Enterprise Support MemoryAgent</span>
      </span>
    </a>
  `;
}
