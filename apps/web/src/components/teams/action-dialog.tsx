'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MutationError } from '@/components/states/mutation-error';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FieldError, FieldHint, Label, Textarea } from '@/components/ui/input';
import type { ApiFailure, ApiResult } from '@/lib/api/types';
import { REASON_MAX } from '@/lib/auth/validation';

export interface ReasonFieldConfig {
  label: string;
  hint: string;
  invalidMessage: string;
  /** Returns true when the (untrimmed) value is acceptable. */
  validate: (value: string) => boolean;
}

export interface ActionDialogProps {
  /** Visible trigger text. */
  triggerLabel: ReactNode;
  /** Accessible name when the visible text alone is ambiguous (e.g. "Remove Neo"). */
  triggerAriaLabel?: string;
  triggerVariant?: ButtonProps['variant'];
  triggerSize?: ButtonProps['size'];
  triggerDisabled?: boolean;
  title: string;
  description?: ReactNode;
  /** Extra read-only content (summary of the affected item). */
  children?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  reason?: ReasonFieldConfig;
  /** Context-specific 409 text when the API sends no known code. */
  conflictMessage?: string;
  /**
   * Runs the mutation. Called once per confirmation (one user intent → one idempotency key,
   * generated inside the browser client).
   */
  onConfirm: (reason: string) => Promise<ApiResult<unknown>>;
  /** Default: `router.refresh()` so Server Components re-fetch. */
  onSuccess?: () => void;
  testId?: string;
}

/**
 * Confirmation dialog for one mutation: focus-trapped (Radix), Escape/cancel closes, focus
 * returns to the trigger, optional reason textarea with inline validation, translated error.
 */
export function ActionDialog({
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = 'secondary',
  triggerSize = 'sm',
  triggerDisabled = false,
  title,
  description,
  children,
  confirmLabel,
  pendingLabel,
  destructive = false,
  reason,
  conflictMessage,
  onConfirm,
  onSuccess,
  testId,
}: ActionDialogProps) {
  const t = useTranslations('teamActions');
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) {
      setValue('');
      setInvalid(false);
      setFailure(null);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (reason && !reason.validate(value)) {
      setInvalid(true);
      reasonRef.current?.focus();
      return;
    }
    setInvalid(false);
    setFailure(null);
    startTransition(async () => {
      const result = await onConfirm(value.trim());
      if (result.ok) {
        setOpen(false);
        setValue('');
        if (onSuccess) onSuccess();
        else router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  const reasonId = `${id}-reason`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size={triggerSize}
          disabled={triggerDisabled}
          {...(triggerAriaLabel ? { 'aria-label': triggerAriaLabel } : {})}
          {...(testId ? { 'data-testid': testId } : {})}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('cancel')}>
        <DialogTitle>{title}</DialogTitle>
        {description ? <DialogDescription>{description}</DialogDescription> : null}
        {children}
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {reason ? (
            <div className="space-y-1.5">
              <Label htmlFor={reasonId}>{reason.label}</Label>
              <Textarea
                ref={reasonRef}
                id={reasonId}
                value={value}
                maxLength={REASON_MAX + 16}
                aria-invalid={invalid || undefined}
                aria-describedby={`${reasonId}-hint${invalid ? ` ${reasonId}-error` : ''}`}
                onChange={(e) => setValue(e.target.value)}
              />
              <FieldHint id={`${reasonId}-hint`}>{reason.hint}</FieldHint>
              <FieldError id={`${reasonId}-error`}>
                {invalid ? reason.invalidMessage : null}
              </FieldError>
            </div>
          ) : null}
          <MutationError failure={failure} {...(conflictMessage ? { conflictMessage } : {})} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              variant={destructive ? 'destructive' : 'primary'}
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
