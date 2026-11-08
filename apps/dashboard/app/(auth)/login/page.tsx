"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Field, FormError } from "../../../components/ui/field.tsx";
import { type FormState, logInAction } from "../actions.ts";

function LogInForm() {
  const next = useSearchParams().get("next") ?? "";
  const [state, action, pending] = useActionState<FormState, FormData>(logInAction, {});

  return (
    <form action={action} className="mt-6 grid gap-4" data-testid="login-form">
      <FormError>{state.error}</FormError>
      <input type="hidden" name="next" value={next} />
      <Field label="Work email" name="email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit" disabled={pending} className="mt-2 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-control bg-action px-6 text-body font-semibold text-action-text hover:brightness-110 disabled:cursor-wait disabled:opacity-70">
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

export default function LogInPage() {
  return (
    <div className="rounded-card border border-line bg-sheet p-6 sm:p-8">
      <title>Log in · Clawback</title>
      <h1 className="text-page leading-tight font-semibold">Log in</h1>
      <p className="mt-1 text-faded">See your savings and anything waiting for your approval.</p>
      <Suspense>
        <LogInForm />
      </Suspense>
      <p className="mt-6 text-faded">
        New to Clawback?{" "}
        <Link href="/signup" className="text-ink underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}
