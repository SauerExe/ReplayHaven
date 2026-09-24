/** Logo aus dem Entwurf: Abspiel-Dreieck mit Balken auf der Akzentfläche. */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="13" fill="currentColor" />
      <path d="M16 12v24l21-12z" fill="#0b0b0f" />
      <path d="M10 14v20" stroke="#0b0b0f" strokeWidth="3" />
    </svg>
  );
}

/** Zehn-Sekunden-Sprung; Lucide hat kein Symbol mit Zahl. */
export function SkipTen({ forward = false, size = 32 }: { forward?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={forward ? 'M20 12a8 8 0 1 1-2.6-5.9' : 'M4 12a8 8 0 1 0 2.6-5.9'} />
      <path d={forward ? 'M20 4v4h-4' : 'M4 4v4h4'} />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="800"
        fill="currentColor"
        stroke="none"
      >
        10
      </text>
    </svg>
  );
}
