import type { UpdateProfileRequest } from '@/lib/api/types';

/** Client-side mirror of the API validation rules (docs/AUTH.md §9). The API re-validates. */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 32;
export const BIOGRAPHY_MAX = 500;
export const REASON_MIN = 3;
export const REASON_MAX = 500;
const NICKNAME_PATTERN = /^[\p{L}\p{N}_.\- ]+$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export type ProfileField = 'nickname' | 'countryCode' | 'biography';
export type ProfileErrorCode =
  'nicknameLength' | 'nicknameChars' | 'countryFormat' | 'biographyLength';

export interface ProfileFormInput {
  nickname: string;
  countryCode: string;
  biography: string;
}

export type ProfileValidation =
  | { ok: true; value: Required<UpdateProfileRequest> }
  | { ok: false; errors: Partial<Record<ProfileField, ProfileErrorCode>> };

/** Count user-perceived characters roughly like the API (code points, not UTF-16 units). */
function length(value: string): number {
  return Array.from(value).length;
}

/**
 * Validate and normalise the profile form: nickname trimmed (2–32, letters/digits/`_.- `),
 * country ISO-3166 alpha-2 uppercase or empty → null, biography ≤ 500 or empty → null.
 */
export function validateProfile(input: ProfileFormInput): ProfileValidation {
  const errors: Partial<Record<ProfileField, ProfileErrorCode>> = {};
  const nickname = input.nickname.trim();
  if (length(nickname) < NICKNAME_MIN || length(nickname) > NICKNAME_MAX) {
    errors.nickname = 'nicknameLength';
  } else if (!NICKNAME_PATTERN.test(nickname)) {
    errors.nickname = 'nicknameChars';
  }
  const country = input.countryCode.trim().toUpperCase();
  if (country !== '' && !COUNTRY_PATTERN.test(country)) errors.countryCode = 'countryFormat';
  const biography = input.biography.trim();
  if (length(biography) > BIOGRAPHY_MAX) errors.biography = 'biographyLength';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      nickname,
      countryCode: country === '' ? null : country,
      biography: biography === '' ? null : biography,
    },
  };
}

/** Admin action reason: 3–500 characters after trimming. */
export function isValidReason(reason: string): boolean {
  const n = length(reason.trim());
  return n >= REASON_MIN && n <= REASON_MAX;
}

/** Map API `details[].field` (dot paths) to a profile form field, or null for form-level errors. */
export function profileFieldOf(apiField: string): ProfileField | null {
  const root = apiField.split('.')[0];
  return root === 'nickname' || root === 'countryCode' || root === 'biography' ? root : null;
}
