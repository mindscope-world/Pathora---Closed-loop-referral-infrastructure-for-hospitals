interface PathoraMarkProps {
  variant?: 'light' | 'dark';
  showWordmark?: boolean;
  className?: string;
}

export function PathoraMark({
  variant = 'light',
  showWordmark = true,
  className = '',
}: PathoraMarkProps) {
  const textColor = variant === 'dark' ? 'text-white' : 'text-[#061B3A]';

  return (
    <span className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      <svg
        width="32"
        height="32"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="pathora-p-grad" x1="6" y1="4" x2="34" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0267D9" />
            <stop offset="55%" stopColor="#0884C8" />
            <stop offset="100%" stopColor="#00A3AE" />
          </linearGradient>
          <linearGradient id="pathora-river-grad" x1="6" y1="38" x2="24" y2="18" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#008E86" />
            <stop offset="100%" stopColor="#14B8B4" />
          </linearGradient>
        </defs>
        {/* P Bowl */}
        <path
          d="M9 5.5C9 4.67157 9.67157 4 10.5 4H21.5C28.9558 4 34.5 9.1 34.5 15.8C34.5 22.5 28.9558 27.5 21.5 27.5H16.2C14.8 27.5 13.5 26.8 12.6 25.8C14.3 23.4 17.5 20.9 22 19.6C18.5 19.2 14.5 20 11.4 22.2C10 23.2 9 22.2 9 20.8V5.5Z"
          fill="url(#pathora-p-grad)"
        />
        {/* Medical Cross Cutout inside Bowl */}
        <path
          d="M19.8 9.2H23.2V12.6H26.6V16H23.2V19.4H19.8V16H16.4V12.6H19.8V9.2Z"
          fill={variant === 'dark' ? '#061B3A' : '#FFFFFF'}
        />
        {/* Flowing Teal Pathway Stem */}
        <path
          d="M6.5 34.5C6.5 27.8 10.5 22.2 18.8 19.5C20.5 18.95 22.4 18.7 23.8 18.8C20.2 20.3 17.6 22.6 16.3 25.8C15.1 28.8 13.4 33.4 8.2 35.8C7.1 36.3 6.5 35.5 6.5 34.5Z"
          fill="url(#pathora-river-grad)"
        />
      </svg>
      {showWordmark && (
        <span
          className={`font-display text-xl font-bold tracking-tight whitespace-nowrap ${textColor}`}
        >
          Pathora
        </span>
      )}
    </span>
  );
}
