import { Header } from "../components/header.tsx";
import { Approval } from "../components/panels/approval.tsx";
import { AuditLog } from "../components/panels/audit-log.tsx";
import { Board } from "../components/panels/board.tsx";
import { Call } from "../components/panels/call.tsx";
import { Findings } from "../components/panels/findings.tsx";
import { Ledger } from "../components/panels/ledger.tsx";
import { Phone } from "../components/panels/phone.tsx";
import { LiveProvider } from "../lib/use-live.tsx";

const COLUMN = "grid min-h-0 gap-3 min-[1100px]:grid-rows-[2fr_3fr]";

// Four columns read as the story: the work, the human, the call, the money. One screen wide, stacked when narrow.
export default function Home() {
  return (
    <LiveProvider>
      <div className="flex min-h-dvh flex-col min-[1100px]:h-dvh">
        <Header />
        <main className="grid min-h-0 flex-1 gap-3 p-3 pt-0 min-[1100px]:grid-cols-[5fr_4fr_5fr_5fr]">
          {/* An even split: the board needs room for all of its states. */}
          <div className="grid min-h-0 gap-3 min-[1100px]:grid-rows-2">
            <Board />
            <Findings />
          </div>
          <div className={COLUMN}>
            <Approval />
            <Phone />
          </div>
          <div className="grid min-h-0">
            <Call />
          </div>
          <div className={COLUMN}>
            <Ledger />
            <AuditLog />
          </div>
        </main>
      </div>
    </LiveProvider>
  );
}
