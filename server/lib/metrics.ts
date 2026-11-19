/**
 * A tiny Prometheus-format metrics registry (no dependency). Counters and a histogram for HTTP traffic, plus job
 * heartbeats, are kept in memory per process; queue depths are read from the database when scraped (see
 * server/modules/ops). Labels are fixed, low-cardinality values (route templates, status classes, job names):
 * never a user, patient, referral or free-text value.
 */
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
const fmt = (labels: Record<string, string>) => {
  const e = Object.entries(labels);
  return e.length ? `{${e.map(([k, v]) => `${k}="${esc(v)}"`).join(',')}}` : '';
};

const BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
interface Hist { counts: number[]; sum: number; count: number }

const requests = new Map<string, number>();
const durations = new Map<string, Hist>();

/** A path segment that looks like an identifier (cuid, referral number, patient code, uuid, number). */
const ID_LIKE = /^(?:[a-z0-9]{20,}|[A-Za-z]+-[\w-]*\d[\w-]*|\d+|[0-9a-f-]{32,})$/;

/**
 * The route TEMPLATE for a request, e.g. `/api/cases/:id/acknowledge`. Express resets `baseUrl` once an error leaves a
 * router, so the prefix is taken from the URL itself, with any identifier-looking segment replaced by `:id`: a referral
 * number, patient code or facility id can never become a metric label (and cardinality stays bounded).
 */
export function routeLabel(req: { route?: { path?: unknown }; originalUrl: string }): string {
  const tpl = req.route?.path;
  if (typeof tpl !== 'string') return 'unmatched';
  const template = tpl === '/' ? '' : tpl;
  const path = req.originalUrl.split('?')[0];
  const re = new RegExp(`${template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+')}/?$`);
  const m = re.exec(path);
  const prefix = (m ? path.slice(0, m.index) : '').split('/').map((seg) => (ID_LIKE.test(seg) ? ':id' : seg)).join('/');
  return `${prefix}${template}` || '/';
}

export function observeRequest(method: string, route: string, status: number, seconds: number) {
  const klass = `${Math.floor(status / 100)}xx`;
  const ckey = JSON.stringify({ method, route, status: klass });
  requests.set(ckey, (requests.get(ckey) ?? 0) + 1);
  const hkey = JSON.stringify({ method, route });
  const h = durations.get(hkey) ?? { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
  BUCKETS.forEach((b, i) => { if (seconds <= b) h.counts[i]++; });
  h.sum += seconds;
  h.count++;
  durations.set(hkey, h);
}

// ── background jobs ──
interface JobState { lastRun: number | null; lastSuccess: number | null; errors: number; runs: number }
const jobs = new Map<string, JobState>();

/** Called by each background loop after every run, so a stalled job shows up as a growing lag. */
export function recordJobRun(job: string, ok: boolean, at: Date = new Date()) {
  const s = jobs.get(job) ?? { lastRun: null, lastSuccess: null, errors: 0, runs: 0 };
  s.runs++;
  s.lastRun = at.getTime() / 1000;
  if (ok) s.lastSuccess = s.lastRun;
  else s.errors++;
  jobs.set(job, s);
}
export const jobSnapshot = () => new Map(jobs);

export interface Gauge { name: string; help: string; samples: Array<{ labels?: Record<string, string>; value: number }> }

/** Renders everything in the Prometheus text exposition format. `gauges` are values computed at scrape time. */
export function renderMetrics(gauges: Gauge[], now: Date = new Date()): string {
  const out: string[] = [];
  const family = (name: string, help: string, type: string) => out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);

  family('pathora_http_requests_total', 'HTTP requests by method, route template and status class.', 'counter');
  for (const [k, v] of requests) out.push(`pathora_http_requests_total${fmt(JSON.parse(k))} ${v}`);

  family('pathora_http_request_duration_seconds', 'HTTP request duration.', 'histogram');
  for (const [k, h] of durations) {
    const base = JSON.parse(k) as Record<string, string>;
    BUCKETS.forEach((b, i) => out.push(`pathora_http_request_duration_seconds_bucket${fmt({ ...base, le: String(b) })} ${h.counts[i]}`));
    out.push(`pathora_http_request_duration_seconds_bucket${fmt({ ...base, le: '+Inf' })} ${h.count}`);
    out.push(`pathora_http_request_duration_seconds_sum${fmt(base)} ${h.sum}`, `pathora_http_request_duration_seconds_count${fmt(base)} ${h.count}`);
  }

  family('pathora_job_runs_total', 'Background job runs since this process started.', 'counter');
  family('pathora_job_errors_total', 'Background job runs that failed since this process started.', 'counter');
  family('pathora_job_last_success_timestamp_seconds', 'Unix time of the last successful run of a background job.', 'gauge');
  family('pathora_job_lag_seconds', 'Seconds since a background job last ran successfully (alert when this grows).', 'gauge');
  for (const [job, s] of jobs) {
    out.push(`pathora_job_runs_total${fmt({ job })} ${s.runs}`, `pathora_job_errors_total${fmt({ job })} ${s.errors}`);
    if (s.lastSuccess !== null) {
      out.push(`pathora_job_last_success_timestamp_seconds${fmt({ job })} ${s.lastSuccess}`, `pathora_job_lag_seconds${fmt({ job })} ${Math.max(0, now.getTime() / 1000 - s.lastSuccess)}`);
    }
  }

  for (const g of gauges) {
    family(g.name, g.help, 'gauge');
    for (const s of g.samples) out.push(`${g.name}${fmt(s.labels ?? {})} ${s.value}`);
  }
  return `${out.join('\n')}\n`;
}

export function resetMetrics() {
  requests.clear();
  durations.clear();
  jobs.clear();
}
