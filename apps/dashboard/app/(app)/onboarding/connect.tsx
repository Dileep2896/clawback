"use client";

import { GAS_SUPPLIER, type Provider } from "@bill-fighter/shared/fixtures";
import { type ReactNode, useActionState, useState } from "react";
import { Field, FormError } from "../../../components/ui/field.tsx";
import { Card } from "../../../components/ui/kit.tsx";
import { type ConnectState, connectPortalAction, type StartState, startAuditAction } from "./actions.ts";

const PROVIDERS: { id: Provider; name: string; service: string }[] = [
  { id: "baycurrent", name: "BayCurrent Electric", service: "Electricity" },
  { id: "baytel", name: "BayTel Business", service: "Phone lines" },
  { id: "bayconnect", name: "BayConnect", service: "Internet" },
  { id: GAS_SUPPLIER.provider, name: GAS_SUPPLIER.name, service: "Gas supply" },
];
const nameOf = (id: Provider) => PROVIDERS.find((p) => p.id === id)!.name;

type Upload = { key: string; name: string; status: "reading" | "saved" | "on_file" | "needs_review" | "error"; note?: string };

const UPLOAD_LABEL: Record<Upload["status"], string> = {
  reading: "Reading your bill…",
  saved: "Added to Bills",
  on_file: "Already on file",
  needs_review: "Needs review",
  error: "Not added",
};

const primary =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-control bg-action px-6 text-body font-semibold text-action-text hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";
const secondary =
  "inline-flex min-h-12 cursor-pointer items-center justify-center rounded-control border border-faded bg-sheet px-5 font-semibold text-ink hover:bg-paper disabled:cursor-wait disabled:opacity-70";

function PortalLogin({ demo, onConnected }: { demo: boolean; onConnected: (provider: Provider) => void }) {
  const [provider, setProvider] = useState<Provider>("baycurrent");
  const [state, action, pending] = useActionState<ConnectState, FormData>(async (previous, form) => {
    const next = await connectPortalAction(previous, form);
    if (next.connected) onConnected(next.connected);
    return next;
  }, {});

  return (
    <form action={action} className="grid gap-5" data-testid="portal-form">
      <fieldset className="grid gap-2">
        <legend className="mb-2 font-semibold">Provider</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PROVIDERS.map((p) => (
            <label
              key={p.id}
              className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-control border px-4 py-2 ${provider === p.id ? "border-agent bg-agent/10" : "border-line hover:bg-paper"}`}
            >
              <input type="radio" name="provider" value={p.id} checked={provider === p.id} onChange={() => setProvider(p.id)} className="size-4 accent-[var(--agent)]" />
              <span>
                <span className="block font-semibold">{p.name}</span>
                <span className="block text-body text-faded">{p.service}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {demo && (
        <div className="grid gap-3 rounded-control border border-line bg-paper p-4">
          <p className="text-body text-faded">
            <span className="mr-2 rounded-full border border-line bg-sheet px-2 py-0.5">Demo data</span>
            {nameOf(provider)}&apos;s demo login is already on file for this account.
          </p>
          <button type="submit" name="demo" value="1" disabled={pending} className={primary} data-testid="demo-login">
            {pending ? "Connecting…" : "Use demo login"}
          </button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Portal username" name="username" autoComplete="off" />
        <Field label="Portal password" name="password" type="password" autoComplete="off" />
      </div>
      <FormError>{state.error}</FormError>
      <div>
        <button type="submit" disabled={pending} className={demo ? secondary : primary} data-testid="connect-portal">
          {pending ? "Checking with the provider…" : `Connect ${nameOf(provider)}`}
        </button>
      </div>
      <p className="text-body text-faded">We check the login with the provider, then keep it in an encrypted vault. Only the agents that fetch your bills use it.</p>
    </form>
  );
}

function UploadBills({ onSaved }: { onSaved: () => void }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState<string>();

  async function send(file: File, key: string) {
    const update = (patch: Partial<Upload>) => setUploads((all) => all.map((u) => (u.key === key ? { ...u, ...patch } : u)));
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/bills/upload", { method: "POST", body: form });
      const body = (await response.json()) as { status?: Upload["status"]; reason?: string; error?: string };
      if (!response.ok) {
        if (response.status === 503) setError(body.error);
        return update({ status: "error", note: body.error });
      }
      update({ status: body.status ?? "needs_review", note: body.reason });
      if (body.status === "saved" || body.status === "on_file") onSaved();
    } catch {
      update({ status: "needs_review", note: "The connection dropped while reading it" });
    }
  }

  function pick(files: FileList | null) {
    setError(undefined);
    const added = [...(files ?? [])].map((file) => ({ file, upload: { key: `${file.name}-${crypto.randomUUID()}`, name: file.name, status: "reading" as const } }));
    setUploads((all) => [...all, ...added.map((a) => a.upload)]);
    // One at a time: each live parse uses the shared Claude login.
    void added.reduce((chain, { file, upload }) => chain.then(() => send(file, upload.key)), Promise.resolve());
  }

  return (
    <div className="grid gap-4">
      <label className="grid cursor-pointer justify-items-center gap-2 rounded-card border-2 border-dashed border-faded/50 bg-paper px-6 py-10 text-center hover:border-agent">
        <span className="text-title font-semibold">Choose bill PDFs</span>
        <span className="text-faded">Electricity, gas, phone or internet. Up to 5 MB each.</span>
        <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" data-testid="upload-input" onChange={(event) => pick(event.target.files)} />
      </label>
      <FormError>{error}</FormError>
      {uploads.length > 0 && (
        <ul className="grid divide-y divide-line rounded-card border border-line" data-testid="upload-list" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-0 truncate">{u.name}</span>
              <span className={`${u.status === "saved" || u.status === "on_file" ? "text-money" : u.status === "reading" ? "text-faded" : "text-alert"}`} data-status={u.status}>
                {UPLOAD_LABEL[u.status]}
                {u.note && <span className="block text-body font-normal text-faded">{u.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Two columns on a wide screen, so "Start my audit" sits above the fold at 1920x1080 next to the connect step. One column when narrow. */
export function ConnectBills({ demo, queued: initiallyQueued, business }: { demo: boolean; queued: boolean; business: ReactNode }) {
  const [tab, setTab] = useState<"portal" | "upload">("portal");
  const [connected, setConnected] = useState<Provider[]>([]);
  const [billsAdded, setBillsAdded] = useState(0);
  const [start, startAction, starting] = useActionState<StartState>(startAuditAction, { queued: initiallyQueued });
  const ready = connected.length > 0 || billsAdded > 0;

  const tabClass = (id: typeof tab) =>
    `min-h-11 cursor-pointer border-b-[3px] px-3 font-semibold ${tab === id ? "border-agent text-ink" : "border-transparent text-faded hover:text-ink"}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <Card title="2. Connect your bills" className="lg:order-1">
        <div role="tablist" aria-label="How to add bills" className="mb-6 flex gap-2 border-b border-line">
          <button type="button" role="tab" aria-selected={tab === "portal"} className={tabClass("portal")} onClick={() => setTab("portal")}>
            Sign in to your provider
          </button>
          <button type="button" role="tab" aria-selected={tab === "upload"} className={tabClass("upload")} onClick={() => setTab("upload")} data-testid="upload-tab">
            Upload bill PDFs
          </button>
        </div>
        {/* Both stay mounted, so switching tabs keeps uploads in progress. */}
        <div hidden={tab !== "portal"}>
          <PortalLogin demo={demo} onConnected={(p) => setConnected((all) => (all.includes(p) ? all : [...all, p]))} />
        </div>
        <div hidden={tab !== "upload"}>
          <UploadBills onSaved={() => setBillsAdded((n) => n + 1)} />
        </div>
        {connected.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-2" data-testid="connected-list">
            {connected.map((p) => (
              <li key={p} className="rounded-full border border-line px-3 py-1">
                ✓ {nameOf(p)} connected
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Narrow: contents, so step 1 sorts first and the order reads 1, 2, 3. Wide: the right-hand column. */}
      <div className="contents lg:order-2 lg:grid lg:gap-6">
        <div className="order-first lg:order-none">{business}</div>
        <Card title="3. Start your audit">
          {start.queued ? (
            <div className="grid gap-2" data-testid="audit-queued" role="status">
              <p className="text-title font-semibold">Audit queued</p>
              <p className="text-faded">
                Your bills are in and your audit is waiting its turn. Your bills page shows what we have read so far. Nothing changes on your accounts without your approval.
              </p>
            </div>
          ) : (
            <form action={startAction} className="grid justify-items-start gap-3">
              <p className="text-faded">The agents fetch a year of bills, check every line, and come back with one approval for you. You can watch them work.</p>
              <FormError>{start.error}</FormError>
              <button type="submit" disabled={!ready || starting} className={primary} data-testid="start-audit">
                {starting ? "Starting the agents…" : "Start my audit"}
              </button>
              {!ready && <p className="text-body text-faded">Connect a provider or add a bill first.</p>}
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
