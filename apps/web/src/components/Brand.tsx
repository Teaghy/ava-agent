export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M7 23 14 8c.8-1.7 3.2-1.7 4 0l7 15M10.5 18h11"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="25" cy="8" r="2" fill="currentColor" />
      </svg>
    </span>
  );
}
