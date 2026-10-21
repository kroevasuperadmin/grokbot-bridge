import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("assistant notes append in order and remain readable from the Bridge store", async () => {
  const original = process.cwd();
  const temp = await mkdtemp(path.join(os.tmpdir(), "bridge-notes-"));
  const oldSupabaseUrl = process.env.SUPABASE_URL;
  const oldSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    process.chdir(temp);
    const storeUrl = new URL("../lib/store.ts", import.meta.url);
    storeUrl.searchParams.set("test", String(Date.now()));
    const { addAssistantNote, listAssistantNotes } = await import(storeUrl.href);
    const first = await addAssistantNote("first note");
    const second = await addAssistantNote("second note");
    const notes = await listAssistantNotes();
    assert.equal(notes.length, 2);
    assert.equal(notes[0].content, "first note");
    assert.equal(notes[1].content, "second note");
    assert.ok(first.created_at <= second.created_at);
    const stored = JSON.parse(await readFile(path.join(temp, "data", "messages.json"), "utf8"));
    assert.equal(stored.length, 2);
  } finally {
    process.chdir(original);
    if (oldSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldSupabaseUrl;
    if (oldSupabaseKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldSupabaseKey;
    await rm(temp, { recursive: true, force: true });
  }
});
