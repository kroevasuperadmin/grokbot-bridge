import { hasTokenConfigured, isAuthorized, misconfigured, REST_SCOPES, unauthorized } from "@/lib/auth";
import { json } from "@/lib/json";
import { boardConfigured, countWaiting, wake } from "@/lib/board";

// Runs on the Vercel cron (vercel.json) and from `node scripts/bridge.mjs wake`.
// Counts approved bot jobs on the board; if there are any, pokes Wisma.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: Request) {
  if (!hasTokenConfigured()) return misconfigured();
  if (!isAuthorized(req, REST_SCOPES.syncGet)) return unauthorized();
  if (!boardConfigured()) return json({ ok: false, error: "board not set up on the bridge" }, 500);
  try {
    const waiting = await countWaiting();
    const woke = waiting > 0 ? await wake(`${waiting} approved job(s) waiting on the board`) : "nothing waiting, no wake";
    return json({ ok: true, waiting, wake: woke });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
}
