import type {
  NotificationsResponse,
  RulePackListResponse,
  RulePackDto,
  RulePackVersionDto,
  SyntheticTestResponse,
  UpdateRulePackRequest,
} from '../../shared/types';
import { api } from '../lib/api';

const enc = encodeURIComponent;

export const listRulePacks = () => api<RulePackListResponse>('/rule-packs');
export const listRulePackVersions = async (key: string) => (await api<{ versions: RulePackVersionDto[] }>(`/rule-packs/${enc(key)}/versions`)).versions;
export const updateRulePack = (key: string, body: UpdateRulePackRequest) => api<RulePackDto>(`/rule-packs/${enc(key)}`, { method: 'PATCH', json: body });
export const runSyntheticTest = (key: string) => api<SyntheticTestResponse>(`/rule-packs/${enc(key)}/synthetic-test`, { method: 'POST' });

export const listNotifications = () => api<NotificationsResponse>('/notifications');
export const markNotificationRead = (id: string) => api<void>(`/notifications/${enc(id)}/read`, { method: 'POST' });
export const markAllNotificationsRead = () => api<{ marked: number }>('/notifications/read-all', { method: 'POST' });
