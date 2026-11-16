'use client';

import { useState, useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TriangleAlert } from 'lucide-react';
import { MutationError } from '@/components/states/mutation-error';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { ApiFailure, ApiResult } from '@/lib/api/types';

export interface FormDialogProps {
  triggerLabel: ReactNode;
  triggerAriaLabel?: string;
  triggerVariant?: ButtonProps['variant'];
  triggerDisabled?: boolean;
  title: string;
  description?: ReactNode;
  /** Prominent warning shown above the fields (e.g. "not server-verified"). */
  warning?: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  /** Form fields (controlled by the caller). */
  children: ReactNode;
  /**
   * Validate and run the mutation. Return null when client validation failed (the caller shows
   * inline errors and focuses the field); otherwise the API result. One call = one user intent.
   */
  onSubmit: () => Promise<ApiResult<unknown>> | null;
  /** Clear caller state when the dialog closes. */
  onReset?: () => void;
  /** Initialise caller state when the dialog opens (e.g. demo-mode reason prefill). */
  onOpen?: () => void;
  testId?: string;
}

/**
 * Modal form for one admin mutation with several fields: focus-trapped (Radix), Escape closes
 * (unless pending), translated API errors, Server Components refreshed on success.
 */
export function FormDialog({
  triggerLabel,
  triggerAriaLabel,
  triggerVariant = 'secondary',
  triggerDisabled = false,
  title,
  description,
  warning,
  confirmLabel,
  pendingLabel,
  destructive = false,
  children,
  onSubmit,
  onReset,
  onOpen,
  testId,
}: FormDialogProps) {
  const t = useTranslations('teamActions');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) onOpen?.();
    if (!next) {
      setFailure(null);
      onReset?.();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setFailure(null);
    const request = onSubmit();
    if (!request) return;
    startTransition(async () => {
      const result = await request;
      if (result.ok) {
        setOpen(false);
        onReset?.();
        router.refresh();
      } else {
        setFailure(result);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant={triggerVariant}
          size="sm"
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
        {warning ? (
          <p
            role="note"
            className="flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
            <span>{warning}</span>
          </p>
        ) : null}
        <form className="space-y-4" onSubmit={submit} noValidate>
          {children}
          <MutationError failure={failure} />
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
