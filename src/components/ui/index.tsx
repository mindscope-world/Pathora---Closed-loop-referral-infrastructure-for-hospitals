/**
 * Pathora UI primitives — the only building blocks screens should need.
 * Tokens live in src/index.css (@theme). Rules of thumb:
 * - Surfaces: bg-surface + border-line + rounded-lg. No gradients, no heavy shadows.
 * - One accent: brand teal for primary actions, links and selection only.
 * - Status colours only inside <Badge>/<StatusBadge>, never for body text.
 * - Mono font only for IDs and codes, never for labels or numbers in prose.
 */
import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { X } from 'lucide-react';
import type { CaseStatus } from '../../data/dashboardData';

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ---- Button ---------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-subtle',
  ghost: 'text-ink-2 hover:text-ink hover:bg-subtle',
  danger: 'bg-danger text-white hover:bg-[#912018]',
  success: 'bg-success text-white hover:bg-[#085d3a]',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md') {
  return cn(
    'inline-flex items-center justify-center font-medium rounded-md whitespace-nowrap transition-colors',
    'disabled:opacity-50 disabled:pointer-events-none cursor-pointer [&_svg]:size-4 [&_svg]:shrink-0',
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size]
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...props },
  ref
) {
  return <button ref={ref} type={type} className={cn(buttonClass(variant, size), className)} {...props} />;
});

// ---- Card -----------------------------------------------------------------

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-surface border border-line rounded-lg shadow-card', className)}
      {...props}
    />
  );
}

interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-4 pb-3', className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ---- Badges ---------------------------------------------------------------

export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-2 border-line',
  brand: 'bg-brand-soft text-brand-ink border-[#b8e2dc]',
  success: 'bg-success-soft text-success border-success-line',
  warning: 'bg-warning-soft text-warning border-warning-line',
  danger: 'bg-danger-soft text-danger border-danger-line',
  info: 'bg-info-soft text-info border-info-line',
};

const DOTS: Record<Tone, string> = {
  neutral: 'bg-ink-3',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

interface BadgeProps {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md border text-xs font-medium whitespace-nowrap',
        TONES[tone],
        className
      )}
    >
      {dot && <span className={cn('size-1.5 rounded-full', DOTS[tone])} aria-hidden="true" />}
      {children}
    </span>
  );
}

export const STATUS_TONE: Record<CaseStatus, Tone> = {
  Active: 'info',
  'Awaiting Ack': 'warning',
  'Overdue SLA': 'danger',
  'Closed Verified': 'success',
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {status}
    </Badge>
  );
}

// ---- Form controls --------------------------------------------------------

export const controlClass = cn(
  'w-full h-9 px-3 text-sm bg-surface text-ink border border-line-strong rounded-md',
  'placeholder:text-ink-3 transition-colors',
  'focus:outline-none focus:border-brand focus:ring-3 focus:ring-brand/15',
  'disabled:bg-subtle disabled:text-ink-3'
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(controlClass, className)} {...props} />;
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(controlClass, 'pr-8 cursor-pointer', className)} {...props} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(controlClass, 'h-auto py-2', className)} {...props} />;
  }
);

interface FieldProps {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

export function Alert({
  tone = 'danger',
  children,
  onDismiss,
}: {
  tone?: Extract<Tone, 'danger' | 'success' | 'warning' | 'info'>;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex items-start justify-between gap-3 rounded-md border px-3.5 py-2.5 text-[13px]', TONES[tone])}
    >
      <div className="min-w-0">{children}</div>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="opacity-70 hover:opacity-100 cursor-pointer">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

// ---- Layout helpers -------------------------------------------------------

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}

/** Title row at the top of each dashboard view. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2 max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Extract<Tone, 'neutral' | 'danger' | 'warning' | 'success'>;
  action?: ReactNode;
}

/** KPI tile: label, big number, one line of context. */
export function Stat({ label, value, hint, tone = 'neutral', action }: StatProps) {
  return (
    <Card className="p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-ink-2">{label}</span>
        {action}
      </div>
      <span
        className={cn(
          'text-[28px] leading-9 font-semibold tabular-nums tracking-tight',
          tone === 'danger' ? 'text-danger' : tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-ink'
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[13px] text-ink-3">{hint}</span>}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="py-12 px-6 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 text-[13px] text-ink-3">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Table styling shared by every data table. */
export const table = {
  wrap: 'overflow-x-auto',
  table: 'w-full text-sm text-left',
  thead: 'border-b border-line bg-subtle/60',
  th: 'px-4 h-10 text-xs font-medium text-ink-3 whitespace-nowrap',
  tr: 'border-b border-line last:border-0 hover:bg-subtle/50 transition-colors',
  td: 'px-4 py-3 text-ink align-middle',
};

// ---- Overlays -------------------------------------------------------------

interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: 'md' | 'lg';
}

/** Close an overlay when Escape is pressed anywhere. */
export function useEscape(onEscape: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEscape();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEscape]);
}

export function Modal({ title, description, onClose, children, size = 'md' }: ModalProps) {
  useEscape(onClose);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'w-full bg-surface rounded-xl shadow-overlay border border-line max-h-[calc(100vh-2rem)] overflow-y-auto',
          size === 'lg' ? 'max-w-2xl' : 'max-w-lg'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-subtle cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
