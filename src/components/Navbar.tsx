import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { PathoraMark } from './PathoraMark';

interface NavbarProps {
  onOpenDiscovery: (defaultPathway?: string) => void;
  onOpenLogin: () => void;
}

const NAV_LINKS = [
  { label: 'Workflow', href: '#workflow' },
  { label: 'Ecosystem', href: '#ecosystem' },
  { label: '90-Day Pilot', href: '#pilot-plan' },
  { label: 'Governance', href: '#governance' },
];

export function Navbar({ onOpenDiscovery, onOpenLogin }: NavbarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 bg-[#F8FAFC]/90 backdrop-blur-md border-b border-slate-200/80">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-element Brand Lockup */}
        <a
          href="#"
          className="whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009CA6] rounded-lg"
          aria-label="Pathora home"
        >
          <PathoraMark variant="light" />
        </a>

        {/* Zone 2: 5 concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-6 lg:gap-7 text-sm font-medium text-slate-600"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="whitespace-nowrap shrink-0 py-1 hover:text-[#061B3A] transition-colors duration-150 relative after:absolute after:left-0 after:bottom-0 after:h-[1.5px] after:w-0 hover:after:w-full after:bg-[#009CA6] after:transition-all after:duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009CA6] rounded"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={onOpenLogin}
            className="whitespace-nowrap shrink-0 py-1 text-[#00828C] font-semibold hover:text-[#061B3A] transition-colors duration-150 relative after:absolute after:left-0 after:bottom-0 after:h-[1.5px] after:w-0 hover:after:w-full after:bg-[#009CA6] after:transition-all after:duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#009CA6] rounded cursor-pointer"
          >
            Sign In
          </button>
        </nav>

        {/* Zone 3: 1 Primary CTA + Mobile Menu Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onOpenDiscovery()}
            className="hidden sm:inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-full transition-colors duration-150 whitespace-nowrap shrink-0 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#008E97] cursor-pointer"
          >
            Book Discovery Call
          </button>

          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-xl border border-slate-200 bg-white text-[#061B3A] hover:bg-slate-50 transition-colors cursor-pointer"
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 py-4 space-y-2 shadow-lg">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block px-3 py-2.5 text-base font-medium text-[#061B3A] rounded-xl hover:bg-slate-50"
            >
              {link.label}
            </a>
          ))}
          <button
            type="button"
            onClick={() => {
              setMobileOpen(false);
              onOpenLogin();
            }}
            className="w-full text-left block px-3 py-2.5 text-base font-semibold text-[#00828C] rounded-xl hover:bg-slate-50 cursor-pointer"
          >
            Sign In
          </button>
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setMobileOpen(false);
                onOpenDiscovery();
              }}
              className="w-full py-3 px-4 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-full transition-colors cursor-pointer"
            >
              Book Discovery Call
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
