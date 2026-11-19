import { useEffect, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { FacilityDto, FacilityInput } from '../../../shared/types';
import * as admin from '../../api/admin';
import type { FacilityPartner } from '../../data/dashboardData';
import { describeApiError } from '../../data/useWorkspace';

const TYPES: Array<[FacilityDto['type'], string]> = [
  ['PUBLIC_REFERRAL', 'Public Referral'],
  ['FAITH_BASED', 'Faith-Based'],
  ['PRIVATE_SPECIALIST', 'Private Specialist'],
  ['COUNTY_DIAGNOSTIC', 'County Diagnostic'],
];
const INTEROP: Array<[FacilityDto['interopMethod'], string]> = [
  ['PORTAL_CSV', 'Portal + CSV'],
  ['API_READY', 'API Ready'],
  ['STATUS_RETURN_DESK', 'Status-Return Desk'],
];

interface Props {
  /** null = adding a new facility. */
  facility: FacilityPartner | null;
  onClose: () => void;
  /** Called after a successful save so the caller can refresh its facility list. */
  onSaved: () => void;
}

export function FacilityFormModal({ facility, onClose, onSaved }: Props) {
  const [name, setName] = useState(facility?.name ?? '');
  const [city, setCity] = useState(facility?.city ?? '');
  const [type, setType] = useState<FacilityInput['type']>(facility?.typeId ?? 'PUBLIC_REFERRAL');
  const [interop, setInterop] = useState<FacilityInput['interopMethod']>(facility?.interopId ?? 'PORTAL_CSV');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = { name, city, type, interopMethod: interop };
      if (facility) await admin.updateFacility(facility.id, body);
      else await admin.createFacility(body);
      onSaved();
      onClose();
    } catch (err) {
      setError(describeApiError(err));
      setBusy(false);
    }
  };

  const field = 'w-full px-3 py-2 bg-[#F8FAFC] border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#061B3A]/60 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="facility-modal-title"
        className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-6 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 id="facility-modal-title" className="font-display text-lg font-bold text-[#061B3A]">
            {facility ? 'Edit Receiving Facility' : 'Add Receiving Facility'}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-[#061B3A] cursor-pointer"><X className="w-4 h-4" /></button>
        </div>

        {error && <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</div>}

        <form onSubmit={submit} className="space-y-3.5 text-xs">
          <div>
            <label htmlFor="fac-name" className="block font-semibold text-[#061B3A] mb-1">Facility name</label>
            <input id="fac-name" className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} placeholder="Kisumu County Specialty Clinic" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fac-city" className="block font-semibold text-[#061B3A] mb-1">Town / city</label>
              <input id="fac-city" className={field} value={city} onChange={(e) => setCity(e.target.value)} required maxLength={80} placeholder="Kisumu" />
            </div>
            <div>
              <label htmlFor="fac-type" className="block font-semibold text-[#061B3A] mb-1">Type</label>
              <select id="fac-type" className={field} value={type} onChange={(e) => setType(e.target.value as FacilityInput['type'])}>
                {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="fac-interop" className="block font-semibold text-[#061B3A] mb-1">How the facility returns status</label>
            <select id="fac-interop" className={field} value={interop} onChange={(e) => setInterop(e.target.value as FacilityInput['interopMethod'])}>
              {INTEROP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-slate-500">The facility&apos;s focal contact is set by inviting someone with the Receiving Facility Focal role under Team &amp; Settings.</p>
          <div className="pt-2 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 cursor-pointer">Cancel</button>
            <button type="submit" disabled={busy} className="px-5 py-2 font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg cursor-pointer">
              {busy ? 'Saving…' : facility ? 'Save Changes' : 'Add Facility'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
