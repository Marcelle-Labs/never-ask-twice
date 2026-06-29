export const BRAND_COLORS = {
  charcoal: "#303030",
  gray: "#8A8F98",
  green: "#4ADE80",
} as const;

export const brandMarkSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-labelledby="nat-mark-title nat-mark-desc">
  <title id="nat-mark-title">Never Ask Twice</title>
  <desc id="nat-mark-desc">Two conversation paths converging into one remembered path forward.</desc>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 30 C38 30 36 50 54 50" stroke="#303030" stroke-width="12"/>
    <path d="M18 70 C38 70 36 50 54 50" stroke="#8A8F98" stroke-width="12"/>
    <path d="M52 50 H78" stroke="#4ADE80" stroke-width="13"/>
    <path d="M68 36 L86 50 L68 64" stroke="#4ADE80" stroke-width="13"/>
  </g>
</svg>`;

export const brandFaviconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Never Ask Twice">
  <rect width="64" height="64" rx="15" fill="#0A0A0A"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M13 21 C26 21 24 32 35 32" stroke="#FAFAFA" stroke-width="7.5"/>
    <path d="M13 43 C26 43 24 32 35 32" stroke="#8A8F98" stroke-width="7.5"/>
    <path d="M33 32 H49" stroke="#4ADE80" stroke-width="8.5"/>
    <path d="M43 23 L56 32 L43 41" stroke="#4ADE80" stroke-width="8.5"/>
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
