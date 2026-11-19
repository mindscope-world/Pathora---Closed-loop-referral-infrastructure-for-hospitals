import { useState, type FormEvent } from 'react';
import { CheckCircle2, FileText, Pencil, Plus, X } from 'lucide-react';
import { LANGUAGE_LABELS, PATHWAY_LABELS, type LanguageId, type MessagingChannelId, type PathwayId, type TemplateDto, type TemplateInput } from '../../../shared/types';
import * as api from '../../api/comms';
import { describeApiError } from '../../data/useWorkspace';
import { ApiError } from '../../lib/api';

const MAX_CHARS = 320;
const PATHWAYS: PathwayId[] = ['CANCER_SCREENING', 'NCD_SCREENING', 'MALE_REPRODUCTIVE_HEALTH'];

const STATUS_STYLE: Record<TemplateDto['status'], string> = {
  APPROVED: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  DRAFT: 'text-amber-800 bg-amber-50 border-amber-200',
  RETIRED: 'text-slate-500 bg-slate-100 border-slate-200',
};
const STATUS_LABEL: Record<TemplateDto['status'], string> = { APPROVED: 'Approved', DRAFT: 'Awaiting approval', RETIRED: 'Retired' };

interface Props {
  templates: TemplateDto[];
  canManage: boolean;
  canApprove: boolean;
  onChanged: () => void;
}

const field = 'w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#009CA6]';

/** Every problem the server found with the wording, one per line (a template can break several rules at once). */
function problemsOf(err: unknown): string[] {
  if (err instanceof ApiError && err.code === 'VALIDATION_ERROR' && Array.isArray(err.details)) {
    return (err.details as Array<{ message?: string }>).map((d) => d.message).filter((m): m is string => Boolean(m));
  }
  return [describeApiError(err)];
}

export function TemplatesPanel({ templates, canManage, canApprove, onChanged }: Props) {
  // undefined = closed, null = new template, a template = editing it
  const [editing, setEditing] = useState<TemplateDto | null | undefined>(undefined);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(problemsOf(err).join(' '));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-bold text-[#061B3A]">Patient Message Templates</h3>
          <p className="text-xs text-slate-500 mt-0.5">Staff draft the wording; the Partner Clinical Lead approves it. Only approved templates can be sent. Editing approved wording sends it back for approval.</p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg cursor-pointer whitespace-nowrap">
            <Plus className="w-3.5 h-3.5" /><span>New Template</span>
          </button>
        )}
      </div>

      {error && <div role="alert" className="mx-5 mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</div>}
      {editing !== undefined && <TemplateForm template={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); onChanged(); }} />}

      <ul className="divide-y divide-slate-100">
        {templates.length === 0 && <li className="px-5 py-8 text-center text-xs text-slate-500">No templates yet.</li>}
        {templates.map((t) => (
          <li key={t.id} className={`px-5 py-4 space-y-2 ${t.status === 'RETIRED' ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#061B3A] flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-slate-400" />{t.name}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {t.channel === 'SMS' ? 'SMS' : 'WhatsApp'} · {LANGUAGE_LABELS[t.language]} · {t.pathway ? PATHWAY_LABELS[t.pathway] : 'All pathways'}
                  {t.approvedBy && <> · approved by {t.approvedBy}</>}
                </p>
              </div>
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${STATUS_STYLE[t.status]}`}>{STATUS_LABEL[t.status]}</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed bg-[#F8FAFC] border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{t.body}</p>
            {t.status !== 'RETIRED' && (
              <div className="flex flex-wrap items-center gap-2">
                {canApprove && t.status === 'DRAFT' && (
                  <button type="button" disabled={busyId === t.id} onClick={() => act(t.id, () => api.approveTemplate(t.id))} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg cursor-pointer">
                    <CheckCircle2 className="w-3.5 h-3.5" /><span>Approve wording</span>
                  </button>
                )}
                {canManage && (
                  <>
                    <button type="button" onClick={() => setEditing(t)} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#061B3A] border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer">
                      <Pencil className="w-3 h-3" /><span>Edit</span>
                    </button>
                    <button type="button" disabled={busyId === t.id} onClick={() => act(t.id, () => api.retireTemplate(t.id))} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-red-700 cursor-pointer">
                      Retire
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TemplateForm({ template, onClose, onSaved }: { template: TemplateDto | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(template?.name ?? '');
  const [channel, setChannel] = useState<MessagingChannelId>(template?.channel ?? 'SMS');
  const [language, setLanguage] = useState<LanguageId>(template?.language ?? 'ENGLISH');
  const [pathway, setPathway] = useState<PathwayId | ''>(template?.pathway ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setProblems([]);
    const input: TemplateInput = { name, channel, language, pathway: pathway || null, body };
    try {
      if (template) await api.updateTemplate(template.id, input);
      else await api.createTemplate(input);
      onSaved();
    } catch (err) {
      setProblems(problemsOf(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="m-5 p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3 text-xs">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-[#061B3A]">{template ? 'Edit template' : 'New template'}</h4>
        <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-[#061B3A] cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      {template?.status === 'APPROVED' && (
        <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">This template is approved. Changing it sends it back to the Partner Clinical Lead for approval.</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label htmlFor="tpl-name" className="block font-semibold text-[#061B3A] mb-1">Name</label>
          <input id="tpl-name" className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} placeholder="Follow-up reminder (English)" />
        </div>
        <div>
          <label htmlFor="tpl-channel" className="block font-semibold text-[#061B3A] mb-1">Channel</label>
          <select id="tpl-channel" className={field} value={channel} onChange={(e) => setChannel(e.target.value as MessagingChannelId)}>
            <option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option>
          </select>
        </div>
        <div>
          <label htmlFor="tpl-lang" className="block font-semibold text-[#061B3A] mb-1">Language</label>
          <select id="tpl-lang" className={field} value={language} onChange={(e) => setLanguage(e.target.value as LanguageId)}>
            <option value="ENGLISH">English</option><option value="KISWAHILI">Kiswahili</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="tpl-path" className="block font-semibold text-[#061B3A] mb-1">Pathway</label>
          <select id="tpl-path" className={field} value={pathway} onChange={(e) => setPathway(e.target.value as PathwayId | '')}>
            <option value="">All pathways</option>
            {PATHWAYS.map((p) => <option key={p} value={p}>{PATHWAY_LABELS[p]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="tpl-body" className="block font-semibold text-[#061B3A] mb-1">Message</label>
        <textarea id="tpl-body" rows={4} className={field} value={body} onChange={(e) => setBody(e.target.value)} required />
        <div className="flex items-start justify-between gap-3 mt-1 text-[11px] text-slate-500">
          <span>Use <code className="font-mono">{'{facility}'}</code> and <code className="font-mono">{'{phone}'}</code> only. No clinical terms (not even &ldquo;screening&rdquo;), no links: messages can be read on a locked phone.</span>
          <span className={`font-mono tabular-nums whitespace-nowrap ${body.length > MAX_CHARS ? 'text-red-700 font-semibold' : ''}`}>{body.length}/{MAX_CHARS}</span>
        </div>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 space-y-1 list-disc list-inside">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-slate-600 cursor-pointer">Cancel</button>
        <button type="submit" disabled={busy} className="px-4 py-1.5 font-semibold text-white bg-[#008E97] hover:bg-[#00767E] disabled:opacity-60 rounded-lg cursor-pointer">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
