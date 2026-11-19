import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { PathoraMark } from './PathoraMark';
import { Button } from './ui';

interface NavbarProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
  onOpenLogin: () => void;
}

const NAV_LINKS = [
  { label: 'How it works', href: '#workflow' },
  { label: 'Pathways', href: '#ecosystem' },
  { label: 'Pilot', href: '#pilot-plan' },
  { label: 'Governance', href: '#governance' },
];

export function Navbar({ onOpenDiscovery, onOpenLogin }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-8">
        <a href="#" className="shrink-0 rounded-md" aria-label="Pathora home">
          <PathoraMark variant="light" />
        </a>

        <nav aria-label="Primary" className="hidden md:flex items-center gap-1 text-sm">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="px-3 py-1.5 rounded-md text-ink-2 hover:text-ink hover:bg-subtle transition-colors"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onOpenLogin}>
              Sign in
            </Button>
            <Button size="sm" onClick={() => onOpenDiscovery()}>
              Book a walkthrough
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden p-2 -mr-2 rounded-md text-ink-2 hover:bg-subtle cursor-pointer"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-line bg-surface px-4 py-3 space-y-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2 rounded-md text-[15px] text-ink hover:bg-subtle"
            >
              {link.label}
            </a>
          ))}
          <div className="pt-3 mt-2 border-t border-line grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMobileOpen(false);
                onOpenLogin();
              }}
            >
              Sign in
            </Button>
            <Button
              onClick={() => {
                setMobileOpen(false);
                onOpenDiscovery();
              }}
            >
              Book a walkthrough
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
