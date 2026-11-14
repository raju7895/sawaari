/* The Sawaari mark — an auto-rickshaw. */
export default function LogoMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className="shrink-0" aria-label="Sawaari">
      <rect width="32" height="32" rx="8" fill="#0d9488" />
      <circle cx="9.5" cy="21" r="2.6" fill="#fff" />
      <circle cx="22.5" cy="21" r="2.6" fill="#fff" />
      <path d="M6 18v-3.5L9 9h9.5l3 5.5H24V18H6Z" fill="#fff" />
      <path d="M8.5 14.5h11" stroke="#0d9488" strokeWidth="1.4" />
      <path d="M12 9l1.5-3h4L19 9" fill="#fff" />
    </svg>
  );
}
