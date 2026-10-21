// The job board (Rizqey Supabase) as seen from the bridge.
//
// Faris, 24 Sep 2026: bots only ever got work when Claude hand-posted it here, and
// their replies never reached the board. Wisma already calls get_pending_tasks on its
// own clock, so the bridge itself now reads "go" jobs off the board, hands them out
// once, and writes replies back onto the job. Rules mirror rizqey-console's own
// bot door (src/app/mcp/route.ts: my_jobs, post_finding, finish_job).

// Bots the bridge knows. Sifo-Dyas is left out on purpose -
// Faris, 23 Sep 2026: "Sifo-Dyas doesn't work. So never delegate jobs to it."
export const BOTS = ["wisma", "herald", "strata", "dossair", "sonar", "doomscrolla", "doomscrollr", "vigil", "tiba"];

export function botKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Plain-words reason a bot may not take jobs, or null when it may. */
export function refusal(name: string): string | null {
  const key = botKey(name);
  if (key.startsWith("sifo")) {
    return "Sifo-Dyas is switched off. Faris said on 23 Sep: it does not work, never give it jobs. No jobs and no messages for this name.";
  }
  // Faris, 25 Sep 2026: "Ur the CTO and the Cloud Sesh is the Head Dev." Cloud sessions sign as "cloud:<name>".
  if (!BOTS.includes(key) && !isCloud(key)) {
    return `"${name}" is not a bot the bridge knows. Known: ${BOTS.join(", ")}, or any cloud:<name>. No jobs for this name.`;
  }
  return null;
}

export function isCloud(key: string): boolean {
  return /^cloud:[a-z0-9._-]+$/.test(key);
}

type Job = {
  id: string;
  difficulty: number;
  title: string;
  simple: string | null;
  plan: string | null;
  steps: string | null;
  detail: string | null;
  link: string | null;
  needs_yes: boolean;
  owner: string;
  status: string;
  note: string | null;
  result: string | null;
};

function env() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export function boardConfigured(): boolean {
  return env() !== null;
}

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const e = env();
  if (!e) throw new Error("board not set up: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const res = await fetch(`${e.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: e.key,
      authorization: `Bearer ${e.key}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`board ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const JOB_COLS = "id,difficulty,title,simple,plan,steps,detail,link,needs_yes,owner,status,note,result";

/** Same rule as the console: whole job assigned to bots or to this bot, or one step names it. */
function isMine(job: Job, bot: string): boolean {
  // A cloud session is the Head Dev: it takes Claude's and Cursor's approved jobs (the laptop runner races it
  // for Cursor's; the status=go lock in takeJobs means only one of them gets each job).
  if (isCloud(bot)) return job.owner === "claude" || job.owner === "cursor";
  if (job.owner === "grokbot" || job.owner === bot) return true;
  const step = new RegExp(`^\\s*\\[${bot}\\]`, "im");
  return step.test(job.steps ?? "");
}

async function goJobs(): Promise<Job[]> {
  return rest<Job[]>(`jobs?select=${JOB_COLS}&status=eq.go&order=difficulty`);
}

// The board only lets "who" be faris, claude, cursor or grokbot (a check on the table,
// read 24 Sep 2026). So every bot line is who=grokbot and names the bot in the first
// line, like "[wisma] ...". Changing that check is a schema change that needs Faris's yes.
async function note(jobId: string, bot: string, body: string): Promise<void> {
  await rest("job_messages", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify([{ job_id: jobId, who: isCloud(bot) ? "claude" : "grokbot", body: `[${bot}] ${body}` }]),
  });
}

export function ruleFor(needsYes: boolean): string {
  return needsYes
    ? "Goes out in his name. Prepare it. Do NOT send, post, publish or submit. Faris says yes on the exact wording first."
    : "Do it and post the result back.";
}

function render(j: Job): string {
  return [
    `JOB #${j.difficulty}: ${j.title}`,
    // His note outranks the doer's own judgement (Faris, 22 Sep 2026). It was never sent before 25 Sep.
    ...(j.note ? [`FARIS'S NOTE (an instruction, follow it first): ${j.note}`] : []),
    ...(j.result ? [`Why it stopped last time: ${j.result}`] : []),
    `In plain words: ${j.simple ?? ""}`,
    `Plan: ${j.plan ?? ""}`,
    `Steps: ${j.steps ?? ""}`,
    `Where it came from: ${j.detail ?? ""}`,
    `Link: ${j.link ?? ""}`,
    `Rule: ${ruleFor(j.needs_yes)}`,
    `Reply with post_message, direction=from_grokbot, first line "JOB #${j.difficulty}". End that first line with the word DONE when it is finished, like "JOB #n DONE", then the finished work below.`,
  ].join("\n");
}

/** Hand this bot its approved ("go") jobs, at most `max` per call. Each one flips to "doing" as it goes out,
 *  so it is never handed out twice.
 *  25 Sep 2026: this used to flip and note each job one by one. With 52 jobs approved at once the call ran past its
 *  time limit, the jobs were already flipped, and the answer carrying them never arrived: 39 jobs sat as "doing"
 *  with nobody on them. Now one update takes the whole batch and one write leaves every pickup note. */
export async function takeJobs(bot: string, max = 15): Promise<{ jobs: { job: number; id: string; title: string; text: string }[]; warnings: string[] }> {
  const warnings: string[] = [];
  // A card with no number cannot be answered ("JOB #null" matches nothing), so it is never handed out (21 Oct 2026).
  const numbered = (await goJobs()).filter((j) => isMine(j, bot));
  const unnumbered = numbered.filter((j) => j.difficulty == null).length;
  if (unnumbered) warnings.push(`${unnumbered} approved job(s) have no card number yet and were held back.`);
  const mine = numbered.filter((j) => j.difficulty != null).slice(0, max);
  if (mine.length === 0) return { jobs: [], warnings };
  // status=eq.go is still the lock: a job another caller already took is simply not in the answer.
  const taken =
    (await rest<Job[]>(`jobs?id=in.(${mine.map((j) => j.id).join(",")})&status=eq.go&select=${JOB_COLS}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "doing" }),
    })) ?? [];
  if (taken.length) {
    try {
      await rest("job_messages", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(
          taken.map((j) => ({ job_id: j.id, who: isCloud(bot) ? "claude" : "grokbot", body: `[${bot}] Picked this up through the bridge.` })),
        ),
      });
    } catch (e) {
      warnings.push(`jobs handed out but the pickup notes failed: ${(e as Error).message}`);
    }
  }
  const left = (await goJobs()).filter((j) => isMine(j, bot)).length;
  if (left) warnings.push(`${left} more approved job(s) are waiting for you: ask again when these are done.`);
  taken.sort((a, b) => (a.difficulty ?? 0) - (b.difficulty ?? 0));
  return { jobs: taken.map((j) => ({ job: j.difficulty, id: j.id, title: j.title, text: render(j) })), warnings };
}

/** How many approved jobs are waiting for any bot. */
export async function countWaiting(): Promise<number> {
  const jobs = await goJobs();
  return jobs.filter((j) => BOTS.some((b) => isMine(j, b))).length;
}

/** A bot's reply whose first line says "JOB #n" lands on that job. DONE or FINISHED in
 *  that line hands the job back to Faris as "ready". Never "done" - a bot saying it is
 *  done is not the same as it being done. */
export async function noteFromBot(
  botName: string,
  content: string,
): Promise<{ job: number; status?: string; error?: string } | null> {
  // trim first: a leading blank line must not hide the JOB line (skeptic, 24 Sep 2026)
  const first = (content.trim().split(/\r?\n/, 1)[0] ?? "").trim();
  const m = first.match(/JOB\s*#\s*(\d+)/i);
  if (!m) return null;
  const job = Number(m[1]);
  const bot = botKey(botName);
  // Same gate as get_pending_tasks: a switched-off or unknown name writes nothing on the board.
  const no = refusal(botName);
  if (no) return { job, error: `${no} Message kept on the bridge only.` };
  if (!boardConfigured()) return { job, error: "board not set up on the bridge (SUPABASE_URL missing)" };
  try {
    const rows = await rest<(Pick<Job, "id" | "status"> & { output_text: string | null })[]>(`jobs?select=id,status,output_text&difficulty=eq.${job}`);
    if (!rows?.length) return { job, error: `no job #${job} on the board; message kept on the bridge only` };
    const { id, status, output_text } = rows[0];
    await note(id, bot, content.trim());
    // finished only when the first line ENDS with DONE or FINISHED. "not done yet" is a
    // progress note, not a hand-back (skeptic, 24 Sep 2026).
    if (!/(?<!\bnot\s)\b(DONE|FINISHED)\s*[.!]?\s*$/i.test(first)) return { job, status: "noted" };
    // Only a job being worked on (doing, or go if it was handed out another way) can be
    // handed back. A job Faris already closed, skipped or has not approved keeps its
    // status and saved output; the reply stays as a note on it.
    const flipped = await rest<Pick<Job, "id">[]>(`jobs?id=eq.${id}&status=in.(doing,go)`, {
      method: "PATCH",
      // append, never replace: earlier work on the card stays (21 Oct 2026)
      body: JSON.stringify({ status: "ready", output_text: [output_text?.trim(), content.trim()].filter(Boolean).join("\n\n"), output_at: new Date().toISOString() }),
    });
    if (!flipped?.length) {
      return { job, status: "noted", error: `job #${job} is "${status}", not being worked on, so it was not handed back; your reply was noted on it only` };
    }
    await note(id, bot, "Finished this one. It is back with you to look at.");
    return { job, status: "ready" };
  } catch (e) {
    return { job, error: (e as Error).message };
  }
}

/** Poke Wisma so it looks at the bridge now instead of on its next scheduled run.
 *  Nobody has the address yet; Faris creates it in the app. */
export async function wake(reason: string): Promise<string> {
  const url = process.env.WISMA_WAKE_URL;
  const key = process.env.WISMA_WAKE_KEY;
  if (!url || !key) return "no wake address set";
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    return `wake sent, HTTP ${res.status}`;
  } catch (e) {
    return `wake failed: ${(e as Error).message}`;
  }
}
