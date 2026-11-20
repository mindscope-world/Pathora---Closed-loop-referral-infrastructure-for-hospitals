import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { formatDateTime } from '../../data/caseViewModel';
import { useNotifications } from '../../data/useNotifications';

interface Props {
  /** Opens the referral a notification is about. */
  onOpenCase: (caseRef: string) => void;
}

export function NotificationBell({ onOpenCase }: Props) {
  const { items, unread, markRead, markAllRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative p-2 rounded-lg border border-slate-200 text-[#061B3A] hover:bg-slate-50 cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-[#061B3A]">Alerts</span>
            {unread > 0 && (
              <button type="button" onClick={markAllRead} className="text-[11px] font-semibold text-[#00828C] hover:text-[#061B3A] cursor-pointer">
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-slate-500">No alerts. You will be told when a referral you own goes overdue or is escalated.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto divide-y divide-slate-100">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!n.readAt) void markRead(n.id);
                      if (n.caseRef) onOpenCase(n.caseRef);
                      setOpen(false);
                    }}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 cursor-pointer ${n.readAt ? '' : 'bg-teal-50/50'}`}
                  >
                    <span className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-[#009CA6] shrink-0" aria-label="Unread" />}
                      <span className="min-w-0">
                        <span className={`block text-xs ${n.readAt ? 'font-medium text-slate-700' : 'font-bold text-[#061B3A]'}`}>{n.title}</span>
                        <span className="block text-[11px] text-slate-600 leading-relaxed mt-0.5">{n.body}</span>
                        <span className="block text-[10px] font-mono text-slate-400 mt-1">{formatDateTime(n.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
