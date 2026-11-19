import { useState } from 'react';
import { Check } from 'lucide-react';
import { PathwayRulePack } from '../../data/dashboardData';
import { Badge, Button, Card, Field, Input, PageHeader, Tone, cn } from '../ui';

interface PathwaysViewProps {
  rulePacks: PathwayRulePack[];
  onUpdateRulePackSla: (id: string, ackSlaHours: number, evalTargetDays: number) => void;
}

const STATUS_TONE: Record<PathwayRulePack['status'], Tone> = {
  Active: 'success',
  Configured: 'info',
  'Coming Soon': 'neutral',
};

export function PathwaysView({ rulePacks, onUpdateRulePackSla }: PathwaysViewProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ackInput, setAckInput] = useState<number>(24);
  const [evalInput, setEvalInput] = useState<number>(7);
  const [simResult, setSimResult] = useState<{ pathway: string; checks: string[] } | null>(null);

  const startEdit = (pack: PathwayRulePack) => {
    setEditingId(pack.id);
    setAckInput(pack.ackSlaHours);
    setEvalInput(pack.evalTargetDays);
  };

  const saveEdit = (id: string) => {
    onUpdateRulePackSla(id, Math.max(4, ackInput), Math.max(1, evalInput));
    setEditingId(null);
  };

  const runSyntheticTest = (pack: PathwayRulePack) => {
    setSimResult({
      pathway: pack.name,
      checks: [
        `Overdue acknowledgment (> ${pack.ackSlaHours}h) alerts the named coordinator.`,
        'Red-flag cases route to the clinical lead.',
        'Failed contact falls back to the human coordinator phone queue.',
        'Synthetic run is excluded from live programme metrics.',
      ],
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pathway rules"
        description="Versioned SLA thresholds and closure criteria, approved by each pathway's clinical lead."
      />

      {simResult && (
        <Card className="px-5 py-4 space-y-3" role="status">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[15px] font-semibold text-ink">Gate test passed</p>
              <p className="text-[13px] text-ink-3">{simResult.pathway} · synthetic data</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSimResult(null)}>
              Dismiss
            </Button>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {simResult.checks.map((check) => (
              <li key={check} className="flex items-start gap-2 text-[13px] text-ink-2">
                <Check className="size-4 text-success shrink-0 mt-0.5" />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {rulePacks.map((pack) => {
          const isComingSoon = pack.status === 'Coming Soon';
          const isEditing = editingId === pack.id;

          return (
            <Card key={pack.id} className={cn('flex flex-col', isComingSoon && 'bg-canvas shadow-none')}>
              <div className="px-5 pt-4 pb-4 space-y-4 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-ink">{pack.name}</h3>
                    <p className="mt-0.5 text-[13px] text-ink-3">{pack.clinicalOwner}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge>{pack.version}</Badge>
                    <Badge tone={STATUS_TONE[pack.status]} dot>
                      {pack.status}
                    </Badge>
                  </div>
                </div>

                {isEditing ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Acknowledgment SLA (hours)" htmlFor={`ack-${pack.id}`}>
                      <Input
                        id={`ack-${pack.id}`}
                        type="number"
                        min={4}
                        max={168}
                        value={ackInput}
                        onChange={(e) => setAckInput(Number(e.target.value))}
                        className="tabular-nums"
                      />
                    </Field>
                    <Field label="Evaluation target (days)" htmlFor={`eval-${pack.id}`}>
                      <Input
                        id={`eval-${pack.id}`}
                        type="number"
                        min={1}
                        max={60}
                        value={evalInput}
                        onChange={(e) => setEvalInput(Number(e.target.value))}
                        className="tabular-nums"
                      />
                    </Field>
                  </div>
                ) : (
                  <dl className="grid grid-cols-3 gap-3">
                    {[
                      ['Contact SLA', `${pack.contactSlaHours}h`],
                      ['Ack SLA', `${pack.ackSlaHours}h`],
                      ['Evaluation', `${pack.evalTargetDays} days`],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-ink-3">{label}</dt>
                        <dd className="text-sm font-medium text-ink tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <dl className="space-y-2 text-[13px]">
                  <div>
                    <dt className="text-xs text-ink-3">Red-flag route</dt>
                    <dd className="text-ink-2 leading-relaxed">{pack.redFlagRule}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">Closure criteria</dt>
                    <dd className="text-ink-2 leading-relaxed">{pack.closureCriteria}</dd>
                  </div>
                </dl>
              </div>

              {!isComingSoon && (
                <div className="px-5 py-3 border-t border-line flex flex-wrap items-center justify-between gap-2">
                  {isEditing ? (
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => saveEdit(pack.id)}>
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <Button variant="secondary" size="sm" onClick={() => startEdit(pack)}>
                      Edit SLAs
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => runSyntheticTest(pack)}>
                    Run gate test
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
