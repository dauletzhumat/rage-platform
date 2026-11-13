import type {
  CreateInvitationRequest,
  CreateTeamApplicationRequest,
  InvitationRole,
} from '@/lib/api/types';
import { isIndividualSteamId64 } from '@/lib/steam-id';

/**
 * Client-side mirror of the M2 policy constants (docs/TEAMS.md §2, ADR-019).
 * Fast feedback only — the API re-validates everything.
 */
export const ROSTER_CAP = 7;
export const MAX_PENDING_INVITATIONS_PER_TEAM = 10;
export const TEAM_NAME_MIN = 3;
export const TEAM_NAME_MAX = 32;
export const TEAM_TAG_MIN = 2;
export const TEAM_TAG_MAX = 6;
export const TEAM_DESCRIPTION_MAX = 500;
export const NOTE_MAX = 500;

const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u;
const TAG_PATTERN = /^[A-Za-z0-9]+$/;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
/** C0/C1 controls except \t and \n; bidi embeddings/overrides/isolates and marks. */
const FORBIDDEN_TEXT_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001f\u007f-\u009f؜‎‏‪-‮⁦-⁩]/;

/** Code points, not UTF-16 units (matches the API's length rules). */
export function textLength(value: string): number {
  return Array.from(value).length;
}

export type ApplicationField = 'name' | 'tag' | 'countryCode' | 'description';
export type ApplicationErrorCode =
  | 'nameLength'
  | 'nameChars'
  | 'tagFormat'
  | 'countryFormat'
  | 'descriptionLength'
  | 'descriptionChars';

export interface ApplicationFormInput {
  name: string;
  tag: string;
  countryCode: string;
  description: string;
}

export type ApplicationValidation =
  | { ok: true; value: CreateTeamApplicationRequest }
  | { ok: false; errors: Partial<Record<ApplicationField, ApplicationErrorCode>> };

/**
 * Validate and normalise a team application: name NFC + trimmed (3–32, letters/digits first,
 * then letters/digits/space/`._-`), tag 2–6 ASCII alphanumerics, optional ISO alpha-2 country
 * (uppercased), optional description ≤ 500 without control/bidi characters. Empty optional
 * fields are omitted from the request.
 */
export function validateTeamApplication(input: ApplicationFormInput): ApplicationValidation {
  const errors: Partial<Record<ApplicationField, ApplicationErrorCode>> = {};

  const name = input.name.normalize('NFC').trim();
  const nameLength = textLength(name);
  if (nameLength < TEAM_NAME_MIN || nameLength > TEAM_NAME_MAX) errors.name = 'nameLength';
  else if (FORBIDDEN_NAME_CHARS.test(name) || !NAME_PATTERN.test(name)) errors.name = 'nameChars';

  const tag = input.tag.trim();
  if (tag.length < TEAM_TAG_MIN || tag.length > TEAM_TAG_MAX || !TAG_PATTERN.test(tag)) {
    errors.tag = 'tagFormat';
  }

  const countryCode = input.countryCode.trim().toUpperCase();
  if (countryCode !== '' && !COUNTRY_PATTERN.test(countryCode))
    errors.countryCode = 'countryFormat';

  const description = input.description.normalize('NFC').trim();
  if (textLength(description) > TEAM_DESCRIPTION_MAX) errors.description = 'descriptionLength';
  else if (FORBIDDEN_TEXT_CHARS.test(description)) errors.description = 'descriptionChars';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      tag,
      ...(countryCode ? { countryCode } : {}),
      ...(description ? { description } : {}),
    },
  };
}

/** Map API `details[].field` to an application form field, or null for form-level errors. */
export function applicationFieldOf(apiField: string): ApplicationField | null {
  const root = apiField.split('.')[0];
  return root === 'name' || root === 'tag' || root === 'countryCode' || root === 'description'
    ? root
    : null;
}

export type InvitationErrorCode = 'steamIdFormat';

export type InvitationValidation =
  { ok: true; value: CreateInvitationRequest } | { ok: false; error: InvitationErrorCode };

/** SteamID64: exactly 17 digits in the individual-account range (the API resolves the user). */
export function validateInvitation(steamId64: string, role: InvitationRole): InvitationValidation {
  const id = steamId64.trim();
  if (!isIndividualSteamId64(id)) return { ok: false, error: 'steamIdFormat' };
  return { ok: true, value: { steamId64: id, role } };
}

/** Optional free-text note (approve note / revoke reason): ≤ 500 characters, may be empty. */
export function isValidOptionalNote(note: string): boolean {
  const trimmed = note.trim();
  return textLength(trimmed) <= NOTE_MAX && !FORBIDDEN_TEXT_CHARS.test(trimmed);
}
