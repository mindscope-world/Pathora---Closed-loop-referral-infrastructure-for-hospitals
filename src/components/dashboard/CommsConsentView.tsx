import { useState, FormEvent } from 'react';
import { Send, ShieldCheck, Ban } from 'lucide-react';
import {
  CommsLogEntry,
  MESSAGE_TEMPLATES,
  ReferralCase,
} from '../../data/dashboardData';

interface CommsConsentViewProps {
  cases: ReferralCase[];
  commsLog: CommsLogEntry[];
  onSendMessage: (
    caseId: string,
    channel: 'SMS' | 'WhatsApp',
    templateName: string
  ) => void;
  onToggleOptOut: (caseId: string) => void;
}

export function CommsConsentView({
  cases,
  commsLog,
  onSendMessage,
  onToggleOptOut,
}: CommsConsentViewProps) {
  const activeCases = cases.filter((c) => c.status !== 'Closed Verified');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(
    activeCases[0]?.id ?? cases[0]?.id ?? ''
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    MESSAGE_TEMPLATES[0].id
  );
  const [channel, setChannel] = useState<'SMS' | 'WhatsApp'>('SMS');
  const [feedback, setFeedback] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedCaseId);
  const selectedTemplate =
    MESSAGE_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? MESSAGE_TEMPLATES[0];

  const handleDispatch = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    onSendMessage(selectedCase.id, channel, selectedTemplate.name);
    if (selectedCase.optedOut) {
      setFeedback(
        `Dispatch blocked: ${selectedCase.patientCode} has opted out of automated messaging. Case routed to human coordinator.`
      );
    } else {
      setFeedback(
        `Discreet ${channel} notification queued for ${selectedCase.patientCode} using "${selectedTemplate.name}".`
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Discreet Dispatch Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-bold text-[#061B3A]">
              Consent-Led Patient Messaging
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Only culturally reviewed, discreet wording is permitted. No clinical diagnoses are transmitted.
            </p>
          </div>

          <form onSubmit={handleDispatch} className="space-y-4">
            <div>
              <label htmlFor="comms-case" className="block text-xs font-semibold text-[#061B3A] mb-1">
                Select Patient Case
              </label>
              <select
                id="comms-case"
                value={selectedCaseId}
                onChange={(e) => {
                  setSelectedCaseId(e.target.value);
                  setFeedback(null);
                }}
                className="w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A]"
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} · {c.patientCode} ({c.optedOut ? 'Opted Out' : 'Consented'})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="comms-channel" className="block text-xs font-semibold text-[#061B3A] mb-1">
                  Channel
                </label>
                <select
                  id="comms-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as 'SMS' | 'WhatsApp')}
                  className="w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A]"
                >
                  <option value="SMS">SMS</option>
                  <option value="WhatsApp">WhatsApp</option>
                </select>
              </div>
              <div>
                <label htmlFor="comms-tpl" className="block text-xs font-semibold text-[#061B3A] mb-1">
                  Approved Template
                </label>
                <select
                  id="comms-tpl"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A]"
                >
                  {MESSAGE_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Template Preview ({selectedTemplate.language})</span>
                <span>{selectedTemplate.reviewedBy}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed">
                {selectedTemplate.body.replace(
                  '{facility}',
                  selectedCase?.receivingFacility ?? 'Receiving Facility'
                )}
              </p>
            </div>

            {selectedCase && selectedCase.optedOut && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                <Ban className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  This patient has opted out of automated messaging. Submitting will block dispatch and log the human-contact requirement.
                </span>
              </div>
            )}

            {feedback && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-[#061B3A]">
                {feedback}
              </div>
            )}

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Send Discreet Message</span>
            </button>
          </form>
        </div>

        {/* Right: Consent Control Ledger */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-[#061B3A]">
                Patient Consent &amp; Opt-Out Controls
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Per-case channel permissions and instant opt-out enforcement
              </p>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#008E97] shrink-0" />
          </div>

          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-5">Patient</th>
                  <th className="py-2.5 px-3">SMS</th>
                  <th className="py-2.5 px-3">WhatsApp</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-5 text-right">Preference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5">
                      <span className="font-mono font-semibold text-[#061B3A]">{c.patientCode}</span>
                      <span className="block text-[11px] text-slate-500">{c.id}</span>
                    </td>
                    <td className="py-3 px-3 text-slate-700">
                      {c.consentSms ? 'Consented' : 'No'}
                    </td>
                    <td className="py-3 px-3 text-slate-700">
                      {c.consentWhatsApp ? 'Consented' : 'No'}
                    </td>
                    <td className="py-3 px-3 font-semibold">
                      {c.optedOut ? (
                        <span className="text-red-700">Opted Out · Human Only</span>
                      ) : (
                        <span className="text-emerald-700">Active Consent</span>
                      )}
                    </td>
                    <td className="py-3 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => onToggleOptOut(c.id)}
                        className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-[#061B3A] cursor-pointer"
                      >
                        {c.optedOut ? 'Restore Consent' : 'Record Opt-Out'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Delivery Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display text-sm font-bold text-[#061B3A]">
            Recent Communication Delivery Log
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Timestamp</th>
                <th className="py-2.5 px-3">Case ID</th>
                <th className="py-2.5 px-3">Channel</th>
                <th className="py-2.5 px-3">Template / Route</th>
                <th className="py-2.5 px-5 text-right">Delivery Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {commsLog.map((entry) => (
                <tr key={entry.id}>
                  <td className="py-3 px-5 font-mono tabular-nums text-slate-600">
                    {entry.timestamp}
                  </td>
                  <td className="py-3 px-3 font-mono font-semibold text-[#061B3A]">
                    {entry.caseId}
                  </td>
                  <td className="py-3 px-3 text-slate-700">{entry.channel}</td>
                  <td className="py-3 px-3 text-slate-700">{entry.templateName}</td>
                  <td className="py-3 px-5 text-right font-semibold">
                    <span
                      className={
                        entry.deliveryStatus === 'Blocked (Opt-out)'
                          ? 'text-red-700'
                          : 'text-emerald-700'
                      }
                    >
                      {entry.deliveryStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
