import { getSession, markModalSeen } from "../lib/session.ts";

async function dismiss() {
  "use server";
  const session = await getSession();
  if (session) await markModalSeen(session);
}

export function SessionModal() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-ink/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-modal-title"
        data-testid="session-modal"
        className="w-full max-w-sm bg-white p-6"
      >
        <h2 id="session-modal-title" className="text-xl font-semibold">
          Your session will expire soon
        </h2>
        <p className="mt-2">Stay signed in to keep working on your accounts.</p>
        <form action={dismiss} className="mt-5">
          <button type="submit" autoFocus data-testid="session-modal-dismiss" className="bg-ink px-5 py-2 font-semibold text-white">
            Stay signed in
          </button>
        </form>
      </div>
    </div>
  );
}
