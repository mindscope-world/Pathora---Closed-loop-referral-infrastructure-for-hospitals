import type { OverviewMetricsDto, UpcomingMetricsDto } from '../../shared/types';
import { api } from '../lib/api';

export const getOverviewMetrics = () => api<OverviewMetricsDto>('/metrics/overview');
export const getUpcomingMetrics = () => api<UpcomingMetricsDto>('/metrics/upcoming');
