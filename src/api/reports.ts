import type { CreateReportScheduleRequest, ReportScheduleDto } from '../../shared/types';
import { api } from '../lib/api';

export const listSchedules = async () => (await api<{ schedules: ReportScheduleDto[] }>('/report-schedules')).schedules;
export const createSchedule = (body: CreateReportScheduleRequest) => api<ReportScheduleDto>('/report-schedules', { method: 'POST', json: body });
export const setScheduleEnabled = (id: string, enabled: boolean) =>
  api<ReportScheduleDto>(`/report-schedules/${encodeURIComponent(id)}`, { method: 'PATCH', json: { enabled } });
export const deleteSchedule = (id: string) => api<void>(`/report-schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
