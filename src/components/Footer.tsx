import { PathoraMark } from './PathoraMark';

interface FooterProps {
  onOpenLogin: () => void;
  onOpenSignup: () => void;
}

const LINKS = [
  { label: 'How it works', href: '#workflow' },
  { label: 'Pathways', href: '#ecosystem' },
  { label: 'Pilot', href: '#pilot-plan' },
  { label: 'Governance', href: '#governance' },
];

export function Footer({ onOpenLogin, onOpenSignup }: FooterProps) {
  const linkClass = 'text-ink-2 hover:text-ink transition-colors cursor-pointer';

  return (
    <footer className="bg-surface border-t border-line">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col md:flex-row md:items-center justify-between gap-6 text-sm">
        <div className="space-y-2">
          <PathoraMark variant="light" />
          <p className="text-ink-3">Closing the gap between screening and care · Nairobi, Kenya</p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </a>
          ))}
          <button type="button" onClick={onOpenLogin} className={linkClass}>
            Sign in
          </button>
          <button type="button" onClick={onOpenSignup} className={linkClass}>
            Create account
          </button>
        </nav>
      </div>
      <div className="border-t border-line">
        <p className="max-w-6xl mx-auto px-4 sm:px-6 py-4 text-xs text-ink-3">
          © {new Date().getFullYear()} Pathora. Supports clinical workflow coordination; does not diagnose or prescribe.
        </p>
      </div>
    </footer>
  );
}
