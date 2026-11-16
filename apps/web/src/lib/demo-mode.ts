import type { ApiResult, MetaResponse } from '@/lib/api/types';

/**
 * Dev-only demo mode: `GET /meta` → `features.sampleMutations.status`. When `enabled`, the API
 * accepts M3 admin actions (tournament edit/status, registration review/substitution, seeds,
 * bracket, SUPER_ADMIN veto override, result override, forfeit) on SAMPLE tournaments. M1/M2
 * sample guards are unchanged. Any failure or unknown value means disabled.
 */
export function isSampleMutationsEnabled(meta: ApiResult<MetaResponse>): boolean {
  return meta.ok && meta.data.features?.sampleMutations?.status === 'enabled';
}

/** Whether actions on an item may be offered: real data always, sample data only in demo mode. */
export function sampleActionsAllowed(isSample: boolean, demoMode: boolean): boolean {
  return !isSample || demoMode;
}
