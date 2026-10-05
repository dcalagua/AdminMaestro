/** Check de éxito que se dibuja una vez (respeta prefers-reduced-motion). */
export function SuccessCheck({ size = 56, className = 'mx-auto' }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 56 56"
      width={size}
      height={size}
      className={`ebim-check-draw text-ok ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="28" cy="28" r="25" />
      <path d="M17 29l7.5 7.5L39.5 21" />
    </svg>
  );
}
