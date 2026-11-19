import { PathoraMark } from './PathoraMark';

interface FooterProps {
  onOpenLogin: () => void;
  onOpenSignup: () => void;
}

export function Footer({ onOpenLogin, onOpenSignup }: FooterProps) {
  return (
    <footer className="bg-[#061B3A] text-white border-t border-white/10">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start pb-10 border-b border-white/10">
          <div className="md:col-span-5 space-y-3">
            <PathoraMark variant="dark" />
            <p className="text-sm text-slate-300 leading-relaxed max-w-sm">
              Closed-loop referral management and accountability infrastructure for screening and preventive healthcare programmes.
            </p>
          </div>

          <div className="md:col-span-4 space-y-2.5">
            <p className="text-xs font-semibold text-teal-200">Platform</p>
            <ul className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm text-slate-300">
              <li>
                <a href="#workflow" className="hover:text-white transition-colors">
                  Workflow Engine
                </a>
              </li>
              <li>
                <a href="#ecosystem" className="hover:text-white transition-colors">
                  Ecosystem &amp; Pathways
                </a>
              </li>
              <li>
                <a href="#pilot-plan" className="hover:text-white transition-colors">
                  90-Day Pilot
                </a>
              </li>
              <li>
                <a href="#governance" className="hover:text-white transition-colors">
                  Clinical Governance
                </a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenLogin}
                  className="hover:text-white transition-colors text-left cursor-pointer text-teal-200 font-medium"
                >
                  Client Sign In
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={onOpenSignup}
                  className="hover:text-white transition-colors text-left cursor-pointer text-teal-200 font-medium"
                >
                  Create Account
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-3 space-y-2 text-sm text-slate-300">
            <p className="text-xs font-semibold text-teal-200">Headquarters</p>
            <p className="font-medium text-white">Nairobi, Kenya</p>
            <p className="text-xs text-slate-400">
              Built for screening programmes, receiving hospitals, and health funders across East Africa.
            </p>
            <p className="text-xs text-slate-400 pt-1">
              Aligned with the Kenya Data Protection Act (2019) &amp; Digital Health Act (2023).
            </p>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-400">
          <p>© {new Date().getFullYear()} Pathora. Closing the gap between screening and care.</p>
          <p>Supports clinical workflow coordination; does not diagnose or prescribe.</p>
        </div>
      </div>
    </footer>
  );
}
