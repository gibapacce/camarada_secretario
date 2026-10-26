/** Mascote original: gato com quepe de estrela (SVG próprio). */
export function Mascot({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path d="M14 30 L12 12 L26 22 Z" fill="#3a2a22" />
      <path d="M50 30 L52 12 L38 22 Z" fill="#3a2a22" />
      <ellipse cx="32" cy="38" rx="20" ry="18" fill="#4a362c" />
      <path d="M14 22 Q32 6 50 22 L48 26 Q32 18 16 26 Z" fill="#a61b1b" />
      <rect x="15" y="24" width="34" height="4" rx="2" fill="#7d1414" />
      <path
        d="M32 10 L33.8 14.6 L38.6 14.8 L34.8 17.8 L36.1 22.4 L32 19.8 L27.9 22.4 L29.2 17.8 L25.4 14.8 L30.2 14.6 Z"
        fill="#f2c14e"
      />
      <ellipse cx="25" cy="37" rx="3.2" ry="4" fill="#f2c14e" />
      <ellipse cx="39" cy="37" rx="3.2" ry="4" fill="#f2c14e" />
      <ellipse cx="25" cy="37.5" rx="1.2" ry="3" fill="#1d1410" />
      <ellipse cx="39" cy="37.5" rx="1.2" ry="3" fill="#1d1410" />
      <path d="M30 44 L34 44 L32 46.5 Z" fill="#e88a8a" />
      <path
        d="M32 46.5 Q29 49 27 47.5 M32 46.5 Q35 49 37 47.5"
        stroke="#1d1410"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M20 44 L8 42 M20 46 L8 47 M44 44 L56 42 M44 46 L56 47"
        stroke="#d9c7b8"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
