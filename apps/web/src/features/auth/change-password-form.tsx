'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { KeyRound, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui';
import { useChangePassword } from '@/features/account/me-queries';
import { detailOf, applyServerFieldErrors, toastError, toastSuccess } from '@/features/auth/auth-feedback';
import { PasswordField, SubmitButton } from '@/features/auth/auth-fields';
import { passwordRule } from '@/features/auth/schemas';
import type { Dictionary } from '@/lib/dictionaries';
import type { Locale } from '@/lib/utils';

/* `PATCH /me/password` — the one self-service credential change the API
 * publishes for a signed-in person.
 *
 * This did not exist when the security screen was written, so that screen said so
 * and promised nothing. `me.controller.ts` now exposes it: the current password is
 * required, and `revokeOthersForUser` kills every session *except* this one, which
 * is why this form does not sign the person out afterwards.
 *
 * The rules are `passwordRule` from `auth/schemas.ts` — the same schema the sign-up
 * and reset forms validate with, so a new password rejected here is one the API
 * would have rejected anyway. The current-password field is deliberately *not* held
 * to that rule: it only has to be non-empty, because it is matched as entered. */

/** Only the two fields the API takes. `confirmPassword` is checked here, never sent. */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: passwordRule,
    confirmPassword: z.string().min(1, 'Enter the new password again')
  })
  .superRefine((value, context) => {
    if (value.confirmPassword !== value.newPassword) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmPassword'], message: 'The two passwords do not match' });
    }
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export function ChangePasswordCard({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const change = useChangePassword(locale);
  const [done, setDone] = useState<string | null>(null);
  /* Two things land here rather than only in a toast.
   *
   * · **`INVALID_CREDENTIALS` carries no field errors.** `me.service.ts` throws a
   *   bare `DomainError`, so `applyServerFieldErrors` has nothing to attach and
   *   the only way the person learns their current password was wrong is a message
   *   that disappears after four seconds.
   * · **How many other sessions were signed out** is the outcome of the whole
   *   operation, and it is not something to say in a toast and say nothing after.
   */
  const [failure, setFailure] = useState<string | null>(null);

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
    mode: 'onBlur'
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(null);
    setDone(null);
    try {
      const result = await change.mutateAsync({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      /* The count is the API's own `otherSessionsRevoked`, not an estimate. */
      const message =
        result.otherSessionsRevoked > 0 ? `${dict.auth.passwordChanged} ${dict.auth.passwordChangedSessions.replace('{count}', String(result.otherSessionsRevoked))}` : dict.auth.passwordChanged;
      /* Cleared rather than left filled: the new password is now in the browser's
         history and its autofill store, and this form has no further use for it. */
      form.reset({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setDone(message);
      toastSuccess(message);
    } catch (error) {
      /* Applied first, because a server that *did* name a field is more specific
         than anything this component would say about the whole form. */
      applyServerFieldErrors(form, error);
      setFailure(detailOf(error, dict));
      toastError(detailOf(error, dict));
    }
  });

  return (
    <Card className="mt-5 p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-navy">
        <KeyRound className="size-4 text-muted" aria-hidden="true" />
        {dict.auth.changePasswordTitle}
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-secondary">{dict.auth.changePasswordText}</p>

      <form onSubmit={onSubmit} className="mt-4 grid gap-3" noValidate>
        <PasswordField
          {...form.register('currentPassword')}
          label={dict.auth.currentPassword}
          error={form.formState.errors.currentPassword?.message}
          autoComplete="current-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />

        <PasswordField
          {...form.register('newPassword')}
          label={dict.auth.passwordNew}
          hint={dict.auth.passwordHint}
          error={form.formState.errors.newPassword?.message}
          autoComplete="new-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />

        <PasswordField
          {...form.register('confirmPassword')}
          label={dict.auth.confirmPassword}
          error={form.formState.errors.confirmPassword?.message}
          autoComplete="new-password"
          showLabel={dict.auth.showPassword}
          hideLabel={dict.auth.hidePassword}
        />

        <SubmitButton pending={form.formState.isSubmitting} pendingLabel={dict.auth.changePasswordBusy} className="mt-1 sm:w-auto">
          {change.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {dict.auth.changePasswordAction}
        </SubmitButton>

        {/* Both outcomes live here as well as in a toast, because a toast is gone
           after four seconds and this is the answer to "did that work?". */}
        {failure !== null ? (
          <p role="alert" className="text-sm font-medium text-rose-700">
            {failure}
          </p>
        ) : null}
        {done !== null ? (
          <p role="status" className="text-sm font-medium text-emerald-700">
            {done}
          </p>
        ) : null}
      </form>
    </Card>
  );
}
