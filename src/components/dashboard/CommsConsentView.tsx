import { useState, FormEvent } from 'react';
import { Send } from 'lucide-react';
import { CommsLogEntry, MESSAGE_TEMPLATES, ReferralCase } from '../../data/dashboardData';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Tone,
  cn,
  table,
} from '../ui';

interface CommsConsentViewProps {
  cases: ReferralCase[];
  commsLog: CommsLogEntry[];
  onSendMessage: (caseId: string, channel: 'SMS' | 'WhatsApp', templateName: string) => void;
  onToggleOptOut: (caseId: string) => void;
}

const DELIVERY_TONE: Record<CommsLogEntry['deliveryStatus'], Tone> = {
  Delivered: 'success',
  Read: 'info',
  'Blocked (Opt-out)': 'danger',
  'Human Routed': 'neutral',
};

/** Small switch: on = opted out of automated messaging. */
function OptOutSwitch({ optedOut, onToggle, label }: { optedOut: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={optedOut}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer',
        optedOut ? 'bg-danger' : 'bg-line-strong'
      )}
    >
      <span
        className={cn(
          'inline-block size-4 rounded-full bg-surface shadow-card transition-transform',
          optedOut ? 'translate-x-[18px]' : 'translate-x-0.5'
        )}
      />
    </button>
  );
}

export function CommsConsentView({ cases, commsLog, onSendMessage, onToggleOptOut }: CommsConsentViewProps) {
  const activeCases = cases.filter((c) => c.status !== 'Closed Verified');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(activeCases[0]?.id ?? cases[0]?.id ?? '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(MESSAGE_TEMPLATES[0].id);
  const [channel, setChannel] = useState<'SMS' | 'WhatsApp'>('SMS');
  const [feedback, setFeedback] = useState<{ text: string; blocked: boolean } | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedCaseId);
  const selectedTemplate = MESSAGE_TEMPLATES.find((t) => t.id === selectedTemplateId) ?? MESSAGE_TEMPLATES[0];

  const handleDispatch = (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCase) return;
    onSendMessage(selectedCase.id, channel, selectedTemplate.name);
    setFeedback(
      selectedCase.optedOut
        ? {
            text: `Blocked: ${selectedCase.patientCode} has opted out of automated messaging. Routed to a human coordinator.`,
            blocked: true,
          }
        : {
            text: `${channel} message queued for ${selectedCase.patientCode} using “${selectedTemplate.name}”.`,
            blocked: false,
          }
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Patient comms"
        description="Send reviewed, discreet follow-up messages and manage each patient's messaging consent."
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <Card className="lg:col-span-5">
          <CardHeader title="Send a message" description="No clinical details are ever included." />
          <form onSubmit={handleDispatch} className="px-5 pb-5 space-y-4">
            <Field label="Patient" htmlFor="comms-case">
              <Select
                id="comms-case"
                value={selectedCaseId}
                onChange={(e) => {
                  setSelectedCaseId(e.target.value);
                  setFeedback(null);
                }}
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.patientName} · {c.patientCode}
                    {c.optedOut ? ' (opted out)' : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-3">
              <Field label="Channel" htmlFor="comms-channel">
                <Select
                  id="comms-channel"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as 'SMS' | 'WhatsApp')}
                >
                  <option value="SMS">SMS</option>
                  <option value="WhatsApp">WhatsApp</option>
                </Select>
              </Field>
              <Field label="Template" htmlFor="comms-tpl">
                <Select id="comms-tpl" value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)}>
                  {MESSAGE_TEMPLATES.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="rounded-md bg-subtle px-3.5 py-3 space-y-1.5">
              <p className="text-xs text-ink-3">
                Preview · {selectedTemplate.language} · reviewed by {selectedTemplate.reviewedBy}
              </p>
              <p className="text-[13px] text-ink-2 leading-relaxed">
                {selectedTemplate.body.replace('{facility}', selectedCase?.receivingFacility ?? 'the receiving facility')}
              </p>
            </div>

            {selectedCase?.optedOut && (
              <Alert tone="warning">
                This patient opted out of automated messages. Sending will be blocked and logged for human follow-up.
              </Alert>
            )}

            {feedback && <Alert tone={feedback.blocked ? 'danger' : 'success'}>{feedback.text}</Alert>}

            <Button type="submit" className="w-full">
              <Send />
              Send message
            </Button>
          </form>
        </Card>

        <Card className="lg:col-span-7 overflow-hidden">
          <CardHeader title="Messaging consent" description="Switch on to record an opt-out. Opted-out patients are contacted by people only." />
          <div className={cn(table.wrap, 'border-t border-line')}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Patient</th>
                  <th className={table.th}>Consented channels</th>
                  <th className={cn(table.th, 'text-right')}>Opted out</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const channels = [c.consentSms && 'SMS', c.consentWhatsApp && 'WhatsApp'].filter(Boolean).join(', ');
                  return (
                    <tr key={c.id} className={table.tr}>
                      <td className={table.td}>
                        <span className="block font-medium whitespace-nowrap">{c.patientName}</span>
                        <span className="block font-mono text-xs text-ink-3">{c.patientCode}</span>
                      </td>
                      <td className={cn(table.td, 'text-ink-2')}>
                        {c.optedOut ? <Badge tone="danger">Human contact only</Badge> : channels || 'None'}
                      </td>
                      <td className={cn(table.td, 'text-right')}>
                        <OptOutSwitch
                          optedOut={c.optedOut}
                          onToggle={() => onToggleOptOut(c.id)}
                          label={`${c.optedOut ? 'Restore consent for' : 'Record opt-out for'} ${c.patientName}`}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Delivery log" />
        {commsLog.length === 0 ? (
          <EmptyState title="No messages sent yet" />
        ) : (
          <div className={cn(table.wrap, 'border-t border-line')}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Sent</th>
                  <th className={table.th}>Referral</th>
                  <th className={table.th}>Channel</th>
                  <th className={table.th}>Template</th>
                  <th className={cn(table.th, 'text-right')}>Status</th>
                </tr>
              </thead>
              <tbody>
                {commsLog.map((entry) => (
                  <tr key={entry.id} className={table.tr}>
                    <td className={cn(table.td, 'text-ink-2 tabular-nums whitespace-nowrap')}>{entry.timestamp}</td>
                    <td className={cn(table.td, 'font-mono text-xs whitespace-nowrap')}>{entry.caseId}</td>
                    <td className={cn(table.td, 'text-ink-2 whitespace-nowrap')}>{entry.channel}</td>
                    <td className={cn(table.td, 'text-ink-2 whitespace-nowrap')}>{entry.templateName}</td>
                    <td className={cn(table.td, 'text-right')}>
                      <Badge tone={DELIVERY_TONE[entry.deliveryStatus]}>{entry.deliveryStatus}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
