import { useState } from 'react';
import { CheckCircle2, Building2, Clock, Pencil, Plus } from 'lucide-react';
import { FacilityPartner, ReferralCase } from '../../data/dashboardData';
import { FacilityFormModal } from './FacilityFormModal';

interface FacilitiesViewProps {
  facilities: FacilityPartner[];
  cases: ReferralCase[];
  onAcknowledgeCase: (caseId: string) => void;
  onConfirmAttendance: (caseId: string) => void;
  onSelectCase: (c: ReferralCase) => void;
  /** Hide controls the server would reject for this role (the server still enforces). */
  canAcknowledge?: boolean;
  canConfirmAttendance?: boolean;
  /** Add and edit receiving facilities (Programme Manager). */
  canManage?: boolean;
  /** Called after a facility is added or edited so the list can be refreshed. */
  onFacilitiesChanged?: () => void;
}

export function FacilitiesView({
  facilities,
  cases,
  onAcknowledgeCase,
  onConfirmAttendance,
  onSelectCase,
  canAcknowledge = true,
  canConfirmAttendance = true,
  canManage = false,
  onFacilitiesChanged,
}: FacilitiesViewProps) {
  // undefined = closed, null = adding, a facility = editing it
  const [editing, setEditing] = useState<FacilityPartner | null | undefined>(undefined);
  const incomingQueue = cases.filter((c) => c.status !== 'Closed Verified');

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-5 py-3.5">
          <div>
            <h2 className="font-display text-sm font-bold text-[#061B3A]">Receiving facilities</h2>
            <p className="text-xs text-slate-500 mt-0.5">The sites your referrals are sent to.</p>
          </div>
          <button type="button" onClick={() => setEditing(null)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg cursor-pointer">
            <Plus className="w-3.5 h-3.5" /><span>Add Facility</span>
          </button>
        </div>
      )}

      {editing !== undefined && (
        <FacilityFormModal facility={editing} onClose={() => setEditing(undefined)} onSaved={() => onFacilitiesChanged?.()} />
      )}

      {/* Partner Receiving Facility Directory */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {facilities.map((facility) => {
          const activeAtSite = cases.filter(
            (c) => c.receivingFacility === facility.name && c.status !== 'Closed Verified'
          ).length;
          const closedAtSite = cases.filter(
            (c) => c.receivingFacility === facility.name && c.status === 'Closed Verified'
          ).length;

          return (
            <div
              key={facility.id}
              className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#009CA6]/12 text-[#00828C] flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold text-[#061B3A]">
                      {facility.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {facility.type} · {facility.city}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span className="font-mono text-[11px] text-[#00828C] font-semibold whitespace-nowrap">
                    {facility.interopMethod}
                  </span>
                  {canManage && (
                    <button type="button" onClick={() => setEditing(facility)} aria-label={`Edit ${facility.name}`}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-[#061B3A] cursor-pointer">
                      <Pencil className="w-3 h-3" />Edit
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-xs">
                <div>
                  <span className="block text-slate-500">Focal Contact</span>
                  <span className="font-medium text-[#061B3A] mt-0.5 block truncate">
                    {facility.focalPerson}
                  </span>
                </div>
                <div>
                  <span className="block text-slate-500">Avg Ack Time</span>
                  <span className="font-mono font-semibold text-[#061B3A] tabular-nums mt-0.5 block">
                    {facility.avgAckHours} hrs
                  </span>
                </div>
                <div className="text-right">
                  <span className="block text-slate-500">Active / Closed</span>
                  <span className="font-mono font-semibold text-[#061B3A] tabular-nums mt-0.5 block">
                    {activeAtSite} / {closedAtSite}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Receiving Facility Status-Return Desk */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-[#061B3A]">
              Receiving Facility Status-Return Desk
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Low-friction route for receiving hospitals to acknowledge referrals, confirm attendance, or return outcomes
            </p>
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-600">
            {incomingQueue.length} open handoffs
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Case ID</th>
                <th className="py-2.5 px-3">Receiving Facility</th>
                <th className="py-2.5 px-3">Pathway</th>
                <th className="py-2.5 px-3">Receipt Ack</th>
                <th className="py-2.5 px-3">Patient Attendance</th>
                <th className="py-2.5 px-5 text-right">Facility Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {incomingQueue.map((item) => {
                const isAcked = Boolean(item.milestones.facilityAcknowledgedAt);
                const isAttended = Boolean(item.milestones.patientAttendedAt);

                return (
                  <tr key={item.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5 font-mono text-xs font-semibold text-[#061B3A] tabular-nums">
                      <button
                        type="button"
                        onClick={() => onSelectCase(item)}
                        className="hover:underline cursor-pointer"
                      >
                        {item.id}
                      </button>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700">{item.receivingFacility}</td>
                    <td className="py-3 px-3 text-xs text-slate-600">{item.pathway}</td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      {isAcked ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Acknowledged
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                          <Clock className="w-3.5 h-3.5" />
                          Pending Ack
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-xs whitespace-nowrap">
                      {isAttended ? (
                        <span className="text-emerald-700 font-medium">Attended</span>
                      ) : (
                        <span className="text-slate-500">Awaiting visit</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right whitespace-nowrap space-x-2">
                      {!isAcked && canAcknowledge && (
                        <button
                          type="button"
                          onClick={() => onAcknowledgeCase(item.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors cursor-pointer"
                        >
                          Acknowledge Receipt
                        </button>
                      )}
                      {isAcked && !isAttended && canConfirmAttendance && (
                        <button
                          type="button"
                          onClick={() => onConfirmAttendance(item.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-lg transition-colors cursor-pointer"
                        >
                          Confirm Attendance
                        </button>
                      )}
                      {isAcked && isAttended && (
                        <button
                          type="button"
                          onClick={() => onSelectCase(item)}
                          className="px-3 py-1.5 text-xs font-semibold text-[#00828C] border border-[#00828C]/30 hover:bg-[#009CA6]/10 rounded-lg transition-colors cursor-pointer"
                        >
                          Document Outcome
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
