import { useState } from 'react';
import { Search, Plus, Upload, RotateCcw } from 'lucide-react';
import { CaseStatus, PathwayName, ReferralCase } from '../../data/dashboardData';
import { ReferralProgressTracker } from './ReferralProgressTracker';

interface CasesViewProps {
  cases: ReferralCase[];
  onSelectCase: (c: ReferralCase) => void;
  onOpenNewCase: () => void;
  onOpenCsvImport: () => void;
}

const STATUS_FILTERS: Array<'All' | CaseStatus> = [
  'All',
  'Active',
  'Awaiting Ack',
  'Overdue SLA',
  'Closed Verified',
];

export function CasesView({
  cases,
  onSelectCase,
  onOpenNewCase,
  onOpenCsvImport,
}: CasesViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | CaseStatus>('All');
  const [pathwayFilter, setPathwayFilter] = useState<'All' | PathwayName>('All');
  const [spotlightId, setSpotlightId] = useState<string>(cases[0]?.id ?? '');

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

  const resetFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setPathwayFilter('All');
  };

  return (
    <div className="space-y-5">
      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patient name, referral ID, coordinator, or hospital..."
              className="w-full pl-9 pr-3.5 py-2 text-sm bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <select
              value={pathwayFilter}
              onChange={(e) => setPathwayFilter(e.target.value as 'All' | PathwayName)}
              aria-label="Filter by pathway"
              className="px-3 py-2 text-xs font-medium bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
            >
              <option value="All">All Pathways</option>
              <option value="Cancer Screening">Cancer Screening</option>
              <option value="NCD Screening">NCD Screening</option>
              <option value="Male Reproductive Health">Male Reproductive Health</option>
            </select>

            <button
              type="button"
              onClick={onOpenCsvImport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#061B3A] bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import CSV</span>
            </button>

            <button
              type="button"
              onClick={onOpenNewCase}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#008E97] hover:bg-[#00767E] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Positive Screen</span>
            </button>
          </div>
        </div>

        {/* Segmented Status Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-1 rounded-lg">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === status
                    ? 'bg-white text-[#061B3A] shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-[#061B3A]'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
          <span className="font-mono text-xs tabular-nums text-slate-500">
            Showing {filtered.length} of {cases.length} cases
          </span>
        </div>
      </div>

      {/* Individual Referral Progress Spotlight */}
      {cases.length > 0 && (() => {
        const spotlightCase =
          cases.find((c) => c.id === spotlightId) ?? filtered[0] ?? cases[0];
        return (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-sm font-bold text-[#061B3A]">
                  Individual Referral Progress Tracker
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select any referral to inspect its closed-loop care progression
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Select referral to track"
                  value={spotlightCase.id}
                  onChange={(e) => setSpotlightId(e.target.value)}
                  className="px-3 py-1.5 text-xs font-mono bg-[#F8FAFC] border border-slate-200 rounded-lg text-[#061B3A] focus:outline-none focus:ring-2 focus:ring-[#009CA6]"
                >
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} · {c.patientName} ({c.patientCode})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => onSelectCase(spotlightCase)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#061B3A] hover:bg-[#0B2954] rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  Manage Case →
                </button>
              </div>
            </div>
            <ReferralProgressTracker referral={spotlightCase} variant="full" />
          </div>
        );
      })()}

      {/* Data Grid or Empty State */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
          <p className="font-display text-base font-bold text-[#061B3A]">
            No referral cases match your current filter
          </p>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            Try clearing your search query or switching back to all pathways and statuses.
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#061B3A] border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
            <button
              type="button"
              onClick={onOpenNewCase}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#008E97] rounded-lg hover:bg-[#00767E] cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Log Positive Screen</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold text-slate-500">
                  <th className="py-3 px-4">Case ID</th>
                  <th className="py-3 px-3">Patient</th>
                  <th className="py-3 px-3">Pathway</th>
                  <th className="py-3 px-3">Named Owner</th>
                  <th className="py-3 px-3">Receiving Facility</th>
                  <th className="py-3 px-3">Journey Progress</th>
                  <th className="py-3 px-3">Status</th>
                  <th className="py-3 px-4 text-right">Due Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => {
                      setSpotlightId(c.id);
                      onSelectCase(c);
                    }}
                    className="hover:bg-slate-50/90 transition-colors cursor-pointer"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[#061B3A] tabular-nums whitespace-nowrap">
                      {c.id}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="text-xs font-semibold text-[#061B3A] block">
                        {c.patientName}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        {c.patientCode} · {c.patientLabel}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-700 whitespace-nowrap">
                      {c.pathway}
                    </td>
                    <td className="py-3 px-3 text-xs font-medium text-[#061B3A] whitespace-nowrap">
                      {c.coordinator}
                    </td>
                    <td className="py-3 px-3 text-xs text-slate-600 truncate max-w-[180px]">
                      {c.receivingFacility}
                    </td>
                    <td className="py-3 px-3">
                      <ReferralProgressTracker referral={c} variant="compact" />
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span
                        className={`text-xs font-semibold ${
                          c.status === 'Closed Verified'
                            ? 'text-emerald-700'
                            : c.status === 'Overdue SLA'
                            ? 'text-red-700'
                            : c.status === 'Awaiting Ack'
                            ? 'text-amber-700'
                            : 'text-[#00828C]'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-slate-600 whitespace-nowrap">
                      {c.dueDate}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
