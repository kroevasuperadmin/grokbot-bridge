import { hasTokenConfigured, isAuthorized, misconfigured, REST_SCOPES, unauthorized } from "@/lib/auth";
import { json } from "@/lib/json";
import { boardConfigured, refusal, takeJobs } from "@/lib/board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Plain web door for cloud sessions (they use curl, not the bot tool door at /mcp).
//   GET /api/jobs?bot=cloud:faris-cccs  -> this name's approved jobs, each marked "doing" as it goes out.
// Hand a job back by posting a message whose first line is "JOB #<number> DONE" (see /api/messages).
export async function GET(req: Request) {
  if (!hasTokenConfigured()) return misconfigured();
  if (!isAuthorized(req, REST_SCOPES.jobsGet)) return unauthorized();
  const bot = (new URL(req.url).searchParams.get("bot") ?? "").trim().toLowerCase();
  if (!bot) return json({ error: "pass ?bot=<your name>" }, 400);
  const no = refusal(bot);
  if (no) return json({ refused: no, jobs: [] }, 403);
  if (!boardConfigured()) return json({ error: "board not set up on the bridge" }, 503);
  return json(await takeJobs(bot));
}
