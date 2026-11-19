import { useState } from 'react';
import { Search } from 'lucide-react';
import { CaseStatus, PathwayName, ReferralCase } from '../../data/dashboardData';
import { ReferralProgressTracker } from './ReferralProgressTracker';
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, StatusBadge, cn, table } from '../ui';

interface CasesViewProps {
  cases: ReferralCase[];
  onSelectCase: (c: ReferralCase) => void;
  onOpenNewCase: () => void;
  onOpenCsvImport: () => void;
}

const STATUS_FILTERS: Array<'All' | CaseStatus> = ['All', 'Active', 'Awaiting Ack', 'Overdue SLA', 'Closed Verified'];

export function CasesView({ cases, onSelectCase, onOpenNewCase, onOpenCsvImport }: CasesViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CaseStatus>('All');
  const [pathwayFilter, setPathwayFilter] = useState<'All' | PathwayName>('All');

  const filtered = cases.filter((c) => {
    const matchesStatus = statusFilter === 'All' || c.status === statusFilter;
    const matchesPathway = pathwayFilter === 'All' || c.pathway === pathwayFilter;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      c.id.toLowerCase().includes(q) ||
      c.patientCode.toLowerCase().includes(q) ||
      c.patientName.toLowerCase().includes(q) ||
      c.coordinator.toLowerCase().includes(q) ||
      c.receivingFacility.toLowerCase().includes(q);
    return matchesStatus && matchesPathway && matchesSearch;
  });

  const countFor = (status: 'All' | CaseStatus) =>
    status === 'All' ? cases.length : cases.filter((c) => c.status === status).length;

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPathwayFilter('All');
  };

  return (
    <div>
      <PageHeader
        title="Referrals"
        description="Every positive screen, from handoff to verified outcome."
      />

      <Card className="overflow-hidden">
        <div className="px-4 pt-3 border-b border-line">
          <div role="tablist" aria-label="Filter by status" className="flex gap-5 overflow-x-auto -mb-px">
            {STATUS_FILTERS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    'pb-2.5 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer',
                    active ? 'border-brand text-ink font-medium' : 'border-transparent text-ink-3 hover:text-ink'
                  )}
                >
                  {status}
                  <span className="ml-1.5 text-xs tabular-nums text-ink-3">{countFor(status)}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="size-4 text-ink-3 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient, ID, owner or facility"
              aria-label="Search referrals"
              className="pl-8"
            />
          </div>
          <Select
            value={pathwayFilter}
            onChange={(e) => setPathwayFilter(e.target.value as 'All' | PathwayName)}
            aria-label="Filter by pathway"
            className="sm:w-56"
          >
            <option value="All">All pathways</option>
            <option value="Cancer Screening">Cancer Screening</option>
            <option value="NCD Screening">NCD Screening</option>
            <option value="Male Reproductive Health">Male Reproductive Health</option>
          </Select>
          <span className="sm:ml-auto text-[13px] text-ink-3 tabular-nums">
            {filtered.length} of {cases.length}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              title={cases.length === 0 ? 'No referrals yet' : 'No referrals match these filters'}
              description={
                cases.length === 0
                  ? 'Log a positive screen or import a CSV batch to start tracking.'
                  : 'Clear the search or switch back to all pathways and statuses.'
              }
              action={
                cases.length === 0 ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={onOpenCsvImport}>
                      Import CSV
                    </Button>
                    <Button size="sm" onClick={onOpenNewCase}>
                      Log positive screen
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" onClick={resetFilters}>
                    Reset filters
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className={cn(table.wrap, 'border-t border-line')}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Patient</th>
                  <th className={table.th}>Owner</th>
                  <th className={table.th}>Facility</th>
                  <th className={table.th}>Progress</th>
                  <th className={table.th}>Status</th>
                  <th className={cn(table.th, 'text-right')}>Due</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => onSelectCase(c)}
                    onKeyDown={(e) => e.key === 'Enter' && onSelectCase(c)}
                    tabIndex={0}
                    className={cn(table.tr, 'cursor-pointer')}
                  >
                    <td className={table.td}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium whitespace-nowrap">{c.patientName}</span>
                        {c.redFlag && <Badge tone="danger">Red flag</Badge>}
                      </div>
                      <div className="text-xs text-ink-3 whitespace-nowrap">
                        <span className="font-mono">{c.id}</span> · {c.pathway}
                      </div>
                    </td>
                    <td className={cn(table.td, 'text-ink-2 whitespace-nowrap')}>{c.coordinator}</td>
                    <td className={cn(table.td, 'text-ink-2')}>
                      <span className="block max-w-[200px] truncate" title={c.receivingFacility}>
                        {c.receivingFacility}
                      </span>
                    </td>
                    <td className={table.td}>
                      <ReferralProgressTracker referral={c} variant="compact" />
                    </td>
                    <td className={table.td}>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className={cn(table.td, 'text-right text-ink-2 tabular-nums whitespace-nowrap')}>{c.dueDate}</td>
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
