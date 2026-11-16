'use client';

import { useTranslations } from 'next-intl';

/** Actions with a required, audited reason. */
export type ReasonPresetKind =
  'result' | 'forfeit' | 'reject' | 'cancel' | 'substitute' | 'ban' | 'lift';

/** Message keys under `reasonPresets` per action (the shared `demoTest` last where it fits). */
export const REASON_PRESET_KEYS: Readonly<Record<ReasonPresetKind, readonly string[]>> = {
  result: ['result.screenshots', 'result.serverCrash', 'result.refereeDecision', 'demoTest'],
  forfeit: ['forfeit.noShow', 'forfeit.withdrew', 'forfeit.rosterIncomplete', 'demoTest'],
  reject: ['reject.incompleteRoster', 'reject.ineligiblePlayer', 'reject.duplicate', 'demoTest'],
  cancel: ['cancel.notEnoughTeams', 'cancel.scheduling', 'cancel.organizer', 'demoTest'],
  substitute: [
    'substitute.unavailable',
    'substitute.technical',
    'substitute.teamRequest',
    'demoTest',
  ],
  ban: ['ban.cheating', 'ban.accountSharing', 'ban.ruleViolation'],
  lift: ['lift.appealAccepted', 'lift.mistake', 'lift.expired', 'demoTest'],
};

/**
 * Translated presets for an action, plus the initial reason: "Demo test" when acting on sample
 * data in demo mode (so the dialog can be submitted immediately), otherwise empty.
 */
export function useReasonPresets(kind: ReasonPresetKind, demoPrefill = false) {
  const t = useTranslations('reasonPresets');
  // Keys are fixed above and checked against every catalog in tests.
  const tr = t as unknown as (key: string) => string;
  return {
    presets: REASON_PRESET_KEYS[kind].map((key) => tr(key)),
    initial: demoPrefill ? t('demoTest') : '',
  };
}

/** One-click chips that fill the reason field; the text stays editable. */
export function ReasonPresetChips({
  presets,
  onPick,
  current,
}: {
  presets: readonly string[];
  onPick: (value: string) => void;
  current: string;
}) {
  const t = useTranslations('reasonPresets');
  if (presets.length === 0) return null;
  return (
    <div role="group" aria-label={t('label')} className="flex flex-wrap gap-1.5">
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          aria-pressed={current.trim() === preset}
          onClick={() => onPick(preset)}
          className="rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-pressed:border-accent aria-pressed:bg-accent/10 aria-pressed:text-foreground"
        >
          {preset}
        </button>
      ))}
    </div>
  );
}
