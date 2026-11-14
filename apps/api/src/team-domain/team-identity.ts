import { type Prisma } from '@rage/db';
import { pickFreeSlug } from './team-policy.js';
import { teamNameTaken, teamTagTaken } from './team-errors.js';

type Tx = Prisma.TransactionClient;

/**
 * Case-insensitive name/tag clash check against existing teams and (optionally) PENDING
 * applications, using `lower()` exactly like the unique indexes (`teams_name_ci_uniq`,
 * `team_applications_pending_name_ci_uniq`, …). The indexes remain the final arbiter for races;
 * this pre-check only produces the precise 409 code early.
 */
export async function assertTeamIdentityFree(
  tx: Tx,
  name: string,
  tag: string,
  options: { includePendingApplications: boolean; excludeApplicationId?: string },
): Promise<void> {
  const teams = await tx.$queryRaw<{ name_clash: boolean; tag_clash: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM teams WHERE lower(name) = lower(${name})) AS name_clash,
      EXISTS (SELECT 1 FROM teams WHERE lower(tag) = lower(${tag})) AS tag_clash`;
  if (teams[0]?.name_clash) throw teamNameTaken();
  if (teams[0]?.tag_clash) throw teamTagTaken();
  if (!options.includePendingApplications) return;
  const exclude = options.excludeApplicationId ?? '00000000-0000-0000-0000-000000000000';
  const pending = await tx.$queryRaw<{ name_clash: boolean; tag_clash: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM team_applications WHERE status = 'PENDING'
              AND id <> ${exclude}::uuid AND lower(requested_name) = lower(${name})) AS name_clash,
      EXISTS (SELECT 1 FROM team_applications WHERE status = 'PENDING'
              AND id <> ${exclude}::uuid AND lower(requested_tag) = lower(${tag})) AS tag_clash`;
  if (pending[0]?.name_clash) throw teamNameTaken();
  if (pending[0]?.tag_clash) throw teamTagTaken();
}

/**
 * First free slug for `base` (`base`, `base-2`, …). Considers team slugs and, when requested,
 * slugs held by PENDING applications (unique index `team_applications_pending_slug_uniq`).
 * `base` only contains `[a-z0-9-]`, so it carries no LIKE wildcards.
 */
export async function chooseFreeSlug(
  tx: Tx,
  base: string,
  options: { includePendingApplications: boolean },
): Promise<string> {
  const pattern = `${base}-%`;
  const rows = options.includePendingApplications
    ? await tx.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM teams WHERE slug = ${base} OR slug LIKE ${pattern}
        UNION
        SELECT requested_slug AS slug FROM team_applications
        WHERE status = 'PENDING' AND (requested_slug = ${base} OR requested_slug LIKE ${pattern})`
    : await tx.$queryRaw<{ slug: string }[]>`
        SELECT slug FROM teams WHERE slug = ${base} OR slug LIKE ${pattern}`;
  return pickFreeSlug(base, new Set(rows.map((r) => r.slug)));
}
