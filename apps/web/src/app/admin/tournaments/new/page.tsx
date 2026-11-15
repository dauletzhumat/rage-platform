import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ForbiddenState } from '@/components/states/forbidden-state';
import { TournamentForm } from '@/components/tournaments/tournament-form';
import { PageHeader } from '@/components/ui/page-header';
import { getMe } from '@/lib/api/server';
import { canCreateTournament } from '@/lib/tournaments/access';

export async function generateMetadata(): Promise<Metadata> {
  const [t, ta] = await Promise.all([
    getTranslations('admin'),
    getTranslations('adminTournaments'),
  ]);
  return { title: `${ta('createTournament')} · ${t('title')}` };
}

/** Create a DRAFT tournament (SUPER_ADMIN or GLOBAL TOURNAMENT_ADMIN; the API authorises). */
export default async function NewTournamentPage() {
  const [me, ta] = await Promise.all([getMe(), getTranslations('adminTournaments')]);
  if (!me.ok) return null;

  return (
    <div className="space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        eyebrow={
          <Link href="/admin/tournaments" className="hover:underline">
            {ta('backToList')}
          </Link>
        }
        title={ta('createTournament')}
        description={ta('createDescription')}
      />
      {canCreateTournament(me.data.roles) ? (
        <div className="max-w-4xl">
          <TournamentForm />
        </div>
      ) : (
        <ForbiddenState title={ta('forbiddenTitle')} description={ta('createForbidden')} />
      )}
    </div>
  );
}
