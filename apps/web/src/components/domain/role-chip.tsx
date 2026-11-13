import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { RoleScopeType, RoleType } from '@/lib/api/types';

/** Role name chip; non-global scopes are appended (e.g. "Team manager · Team"). */
export function RoleChip({ role, scopeType }: { role: RoleType; scopeType: RoleScopeType }) {
  const t = useTranslations('roleNames');
  const ts = useTranslations('scopeNames');
  return (
    <Badge tone={role === 'SUPER_ADMIN' ? 'accent' : 'outline'}>
      {t(role)}
      {scopeType !== 'GLOBAL' ? <span className="text-muted">· {ts(scopeType)}</span> : null}
    </Badge>
  );
}
