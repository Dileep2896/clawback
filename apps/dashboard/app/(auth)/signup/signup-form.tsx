"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormError } from "../../../components/ui/field.tsx";
import { type FormState, signUpAction, tryItNowAction } from "../actions.ts";

export function SignUpForm({ sandbox }: { sandbox: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(signUpAction, {});
  const [tryState, tryIt, trying] = useActionState<FormState>(tryItNowAction, {});
  const value = (name: string) => state.fields?.[name];

  return (
    <div className="rounded-card border border-line bg-sheet p-6 sm:p-8">
      <title>Create your account · Clawback</title>
      <h1 className="text-page leading-tight font-semibold">Create your account</h1>
      <p className="mt-1 text-faded">Connect your bills next. It takes about 30 seconds.</p>
      {sandbox && (
        <form action={tryIt} className="mt-6 grid gap-2 rounded-card border border-line p-4" data-testid="try-it-now">
          <FormError>{tryState.error}</FormError>
          <p className="font-semibold">Judging? Skip the form.</p>
          <p className="text-faded">A fresh sandbox account of your own, with the demo business&apos;s bills already on file.</p>
          <button type="submit" disabled={trying} className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-control bg-action px-6 text-body font-semibold text-action-text hover:brightness-110 disabled:cursor-wait disabled:opacity-70">
            {trying ? "Setting up your sandbox…" : "Try it now"}
          </button>
        </form>
      )}
      <form action={action} className="mt-6 grid gap-4" data-testid="signup-form">
        <FormError>{state.error}</FormError>
        <Field label="Your name" name="name" autoComplete="name" required defaultValue={value("name")} />
        <Field label="Company" name="company" autoComplete="organization" required defaultValue={value("company")} />
        <Field label="Work email" name="email" type="email" autoComplete="email" required defaultValue={value("email")} />
        <Field label="Password" name="password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters" />
        <button type="submit" disabled={pending} className="mt-2 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-control bg-action px-6 text-body font-semibold text-action-text hover:brightness-110 disabled:cursor-wait disabled:opacity-70">
          {pending ? "Creating your account…" : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-faded">
        Already have an account?{" "}
        <Link href="/login" className="text-ink underline underline-offset-4">
          Log in
        </Link>
      </p>
    </div>
  );
}
