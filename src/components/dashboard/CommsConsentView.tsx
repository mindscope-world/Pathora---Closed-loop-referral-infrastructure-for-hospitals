import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Ban, PhoneCall, Send, ShieldCheck } from 'lucide-react';
import { PATHWAY_LABELS, type CommsLogDto, type DeliveryStatusId, type OrganizationDto, type SendMessageResponse } from '../../../shared/types';
import * as api from '../../api/comms';
import * as admin from '../../api/admin';
import { formatDateTime } from '../../data/caseViewModel';
import type { ReferralCase } from '../../data/dashboardData';
import { useComms } from '../../data/useComms';
import { describeApiError } from '../../data/useWorkspace';
import { ApiError } from '../../lib/api';
import { TemplatesPanel } from './TemplatesPanel';

interface Props {
  cases: ReferralCase[];
  /** Manager / coordinator: may send messages and set patient numbers. */
  canSend: boolean;
  /** Data Protection Contact: may record opt-outs and per-channel consent. */
  canManageConsent: boolean;
  /** Manager / coordinator may draft templates; the clinical lead approves them. */
  canManageTemplates: boolean;
  canApproveTemplates: boolean;
  onToggleOptOut: (caseId: string) => void;
  onSetChannelConsent: (caseId: string, channel: 'SMS' | 'WHATSAPP', granted: boolean) => void;
  /** Refresh the case list after something changed server-side (a number was added). */
  onCasesChanged: () => void;
}

const STATUS: Record<DeliveryStatusId, { label: string; style: string }> = {
  QUEUED: { label: 'Queued', style: 'text-amber-700' },
  SENDING: { label: 'Sending', style: 'text-amber-700' },
  SENT: { label: 'Sent', style: 'text-[#00828C]' },
  DELIVERED: { label: 'Delivered', style: 'text-emerald-700' },
  READ: { label: 'Read', style: 'text-emerald-700' },
  FAILED: { label: 'Failed', style: 'text-red-700' },
  BLOCKED_OPTOUT: { label: 'Blocked (consent)', style: 'text-red-700' },
  HUMAN_ROUTED: { label: 'Needs a person', style: 'text-amber-800' },
};

const field = 'w-full px-3 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

/** The server's own rule, mirrored here only to explain beforehand what will happen. The server decides. */
function consentProblem(c: ReferralCase, channel: 'SMS' | 'WHATSAPP'): string | null {
  if (c.optedOut) return 'This patient has opted out of automated messages.';
  const ok = channel === 'SMS' ? c.consentSms : c.consentWhatsApp;
  return ok ? null : `No ${channel === 'SMS' ? 'SMS' : 'WhatsApp'} consent is recorded for this patient.`;
}

export function CommsConsentView({ cases, canSend, canManageConsent, canManageTemplates, canApproveTemplates, onToggleOptOut, onSetChannelConsent, onCasesChanged }: Props) {
  const comms = useComms();
  const [org, setOrg] = useState<OrganizationDto | null>(null);
  useEffect(() => {
    admin.getOrganization().then(setOrg, () => undefined);
  }, []);

  const [selectedCaseId, setSelectedCaseId] = useState(() => (cases.find((c) => c.status !== 'Closed Verified') ?? cases[0])?.id ?? '');
  const [channel, setChannel] = useState<'SMS' | 'WHATSAPP'>('SMS');
  const [templateId, setTemplateId] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID()); // one key per attempt: a double-click queues one message

  const [phoneInput, setPhoneInput] = useState('');
  const [phoneMsg, setPhoneMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = cases.find((c) => c.id === selectedCaseId);

  // Only templates that can actually be sent for this case: approved, right channel, right pathway.
  const usable = useMemo(
    () => comms.templates.filter((t) => t.status === 'APPROVED' && t.channel === channel && (!t.pathway || (selected && PATHWAY_LABELS[t.pathway] === selected.pathway))),
    [comms.templates, channel, selected],
  );
  useEffect(() => {
    if (!usable.some((t) => t.id === templateId)) setTemplateId(usable[0]?.id ?? '');
  }, [usable, templateId]);
  const template = usable.find((t) => t.id === templateId);

  const preview = template
    ? template.body.replace(/\{facility\}/g, selected?.receivingFacility ?? 'the facility').replace(/\{phone\}/g, org?.supportPhone ?? '[support phone not set]')
    : '';
  const needsSupportPhone = template?.placeholders.includes('phone') && org !== null && !org.supportPhone;
  const blocked = selected ? consentProblem(selected, channel) : null;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !template || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res: SendMessageResponse = await api.sendMessage(selected.id, { templateId: template.id, channel }, key.current);
      key.current = crypto.randomUUID();
      setFeedback({ ok: res.accepted, text: res.message });
    } catch (err) {
      setFeedback({ ok: false, text: describeApiError(err) });
    } finally {
      setBusy(false);
      void comms.reloadLog();
    }
  };

  const saveNumber = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !phoneInput.trim()) return;
    setPhoneMsg(null);
    try {
      await api.setContact(selected.id, phoneInput);
      setPhoneInput('');
      setPhoneMsg({ ok: true, text: 'Mobile number saved.' });
      onCasesChanged();
    } catch (err) {
      setPhoneMsg({ ok: false, text: err instanceof ApiError && err.code === 'VALIDATION_ERROR' ? Object.values(err.fieldErrors).join(' ') : describeApiError(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Discreet Dispatch Form */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="font-display text-base font-bold text-[#061B3A]">Consent-Led Patient Messaging</h2>
            <p className="text-xs text-slate-500 mt-0.5">Only approved, discreet wording is permitted. No clinical details are ever transmitted, and nothing is sent without the patient&apos;s consent for that channel.</p>
          </div>

          {!canSend ? (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">Your role can review communications and consent but not send messages.</p>
          ) : (
            <form onSubmit={send} className="space-y-4">
              <div>
                <label htmlFor="comms-case" className="block text-xs font-semibold text-[#061B3A] mb-1">Select Patient Case</label>
                <select id="comms-case" value={selectedCaseId} onChange={(e) => { setSelectedCaseId(e.target.value); setFeedback(null); setPhoneMsg(null); }} className={field}>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>{c.id} · {c.patientCode} ({c.optedOut ? 'Opted Out' : c.consentSms || c.consentWhatsApp ? 'Consented' : 'No consent'})</option>
                  ))}
                </select>
              </div>

              {selected && (
                <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-slate-600"><PhoneCall className="w-3.5 h-3.5" />Mobile number</span>
                    <span className={`font-semibold ${selected.hasPhone ? 'text-emerald-700' : 'text-amber-700'}`}>{selected.hasPhone ? 'On file' : 'None on file'}</span>
                  </div>
                  <form onSubmit={saveNumber} className="flex gap-2">
                    <input aria-label="Patient mobile number" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} placeholder={selected.hasPhone ? 'Replace number…' : '0712 345 678'} inputMode="tel" autoComplete="off" className="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-md" />
                    <button type="submit" disabled={!phoneInput.trim()} className="px-3 py-1.5 text-xs font-semibold text-[#061B3A] border border-slate-200 hover:bg-slate-50 disabled:opacity-50 rounded-md cursor-pointer">Save</button>
                  </form>
                  {phoneMsg && <p role={phoneMsg.ok ? 'status' : 'alert'} className={phoneMsg.ok ? 'text-emerald-700' : 'text-red-700'}>{phoneMsg.text}</p>}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="comms-channel" className="block text-xs font-semibold text-[#061B3A] mb-1">Channel</label>
                  <select id="comms-channel" value={channel} onChange={(e) => { setChannel(e.target.value as 'SMS' | 'WHATSAPP'); setFeedback(null); }} className={field}>
                    <option value="SMS">SMS</option>
                    <option value="WHATSAPP">WhatsApp</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="comms-tpl" className="block text-xs font-semibold text-[#061B3A] mb-1">Approved Template</label>
                  <select id="comms-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={usable.length === 0} className={field}>
                    {usable.length === 0 ? <option value="">None available</option> : usable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>

              {template ? (
                <div className="bg-[#F8FAFC] border border-slate-200 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] text-slate-500"><span>Preview ({template.language === 'ENGLISH' ? 'English' : 'Kiswahili'})</span><span>{template.reviewedBy}</span></div>
                  <p className="text-xs text-slate-700 leading-relaxed">{preview}</p>
                </div>
              ) : (
                <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">No approved {channel === 'SMS' ? 'SMS' : 'WhatsApp'} template fits this referral. Draft one below and ask the Partner Clinical Lead to approve it.</p>
              )}

              {blocked && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  <Ban className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{blocked} Sending will not deliver anything: it will be logged and the case owner asked to contact the patient directly.</span>
                </div>
              )}
              {needsSupportPhone && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">This template mentions a support phone number, but none is set. Add one under Team &amp; Settings first.</p>
              )}
              {feedback && (
                <div role={feedback.ok ? 'status' : 'alert'} className={`rounded-xl p-3 text-xs border ${feedback.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-slate-50 border-slate-200 text-[#061B3A]'}`}>{feedback.text}</div>
              )}

              <button type="submit" disabled={busy || !template || !selected} className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg transition-colors cursor-pointer">
                <Send className="w-4 h-4" />
                <span>{busy ? 'Sending…' : 'Send Discreet Message'}</span>
              </button>
            </form>
          )}
        </div>

        {/* Right: Consent Control Ledger */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-[#061B3A]">Patient Consent &amp; Opt-Out Controls</h2>
              <p className="text-xs text-slate-500 mt-0.5">Per-channel permissions. A patient replying STOP is opted out immediately.</p>
            </div>
            <ShieldCheck className="w-5 h-5 text-[#008E97] shrink-0" />
          </div>
          <div className="overflow-x-auto flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-2.5 px-5">Patient</th><th className="py-2.5 px-3">SMS</th><th className="py-2.5 px-3">WhatsApp</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-5 text-right">Preference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="py-3 px-5"><span className="font-mono font-semibold text-[#061B3A]">{c.patientCode}</span><span className="block text-[11px] text-slate-500">{c.id}</span></td>
                    {(['SMS', 'WHATSAPP'] as const).map((ch) => {
                      const on = ch === 'SMS' ? c.consentSms : c.consentWhatsApp;
                      return (
                        <td key={ch} className="py-3 px-3 text-slate-700 whitespace-nowrap">
                          {on ? 'Consented' : 'No'}
                          {canManageConsent && !c.optedOut && (
                            <button type="button" onClick={() => onSetChannelConsent(c.id, ch, !on)} className="ml-2 text-[11px] font-medium text-[#00828C] hover:text-[#061B3A] cursor-pointer">{on ? 'Withdraw' : 'Record'}</button>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-3 px-3 font-semibold">{c.optedOut ? <span className="text-red-700">Opted Out · Human Only</span> : <span className="text-emerald-700">Active Consent</span>}</td>
                    <td className="py-3 px-5 text-right">
                      {canManageConsent && (
                        <button type="button" onClick={() => onToggleOptOut(c.id)} className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-[#061B3A] cursor-pointer">
                          {c.optedOut ? 'Restore Consent' : 'Record Opt-Out'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <TemplatesPanel templates={comms.templates} canManage={canManageTemplates} canApprove={canApproveTemplates} onChanged={() => void comms.reloadTemplates()} />

      {/* Delivery Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-sm font-bold text-[#061B3A]">Communication Delivery Log</h3>
            <p className="text-xs text-slate-500 mt-0.5">Updates as the network reports back. Anything that could not be delivered is also sent to the case owner as an alert.</p>
          </div>
        </div>
        {comms.error && <div role="alert" className="px-5 py-3 text-xs text-red-800 bg-red-50 border-b border-red-200">{comms.error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                <th className="py-2.5 px-5">Requested</th><th className="py-2.5 px-3">Case ID</th><th className="py-2.5 px-3">Channel</th><th className="py-2.5 px-3">Template / Route</th><th className="py-2.5 px-5 text-right">Delivery Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {comms.log.map((e: CommsLogDto) => {
                const s = STATUS[e.status];
                const waiting = e.status === 'QUEUED' && e.scheduledFor && Date.parse(e.scheduledFor) > Date.now();
                return (
                  <tr key={e.id}>
                    <td className="py-3 px-5 font-mono tabular-nums text-slate-600 whitespace-nowrap">{formatDateTime(e.requestedAt)}</td>
                    <td className="py-3 px-3 font-mono font-semibold text-[#061B3A]">{e.caseId}</td>
                    <td className="py-3 px-3 text-slate-700">{e.channel === 'SMS' ? 'SMS' : e.channel === 'WHATSAPP' ? 'WhatsApp' : 'Voice Call'}</td>
                    <td className="py-3 px-3 text-slate-700">{e.templateName}</td>
                    <td className="py-3 px-5 text-right">
                      <span className={`font-semibold ${s.style}`}>{s.label}</span>
                      {waiting && <span className="block text-[11px] text-slate-500">sends {formatDateTime(e.scheduledFor!)}</span>}
                      {e.attempts > 1 && e.status !== 'FAILED' && <span className="block text-[11px] text-slate-500">attempt {e.attempts}</span>}
                      {e.failureReason && <span className="block text-[11px] text-slate-500 max-w-[16rem] ml-auto">{e.failureReason}</span>}
                    </td>
                  </tr>
                );
              })}
              {comms.status === 'ready' && comms.log.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-slate-500">No messages yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
