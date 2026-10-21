import fs from "fs";
import path from "path";

const outDir = path.join(process.cwd(), "context");
const sources = [
  ["CLAUDE.md", "C:/Users/diony/.claude/CLAUDE.md"],
  ["STARTUP_HIERARCHY.md", "C:/Users/diony/dev/rl-team/STARTUP_HIERARCHY.md"],
  ["OPEN_ITEMS.md", "C:/Users/diony/dev/rl-team/OPEN_ITEMS.md"],
  ["HANDOFF_2OCT.md", "C:/Users/diony/dev/rl-team/HANDOFF_2OCT.md"],
  ["RESUME_NOW.md", "C:/Users/diony/dev/rl-team/RESUME_NOW.md"],
  ["MEMORY.md", "C:/Users/diony/.claude/projects/C--WINDOWS-system32/memory/MEMORY.md"],
  ["NO_AI_SLOP.md", "C:/Users/diony/dev/gtm_links/NO_AI_SLOP.md"],
];
const memoryIndex = "C:/Users/diony/.claude/projects/C--WINDOWS-system32/memory/MEMORY.md";

fs.mkdirSync(outDir, { recursive: true });
for (const [name, src] of sources) {
  fs.copyFileSync(src, path.join(outDir, name));
  console.log("copied", name, fs.statSync(src).size);
}

const memoryDir = path.dirname(memoryIndex);
const text = fs.readFileSync(memoryIndex, "utf8");
// Links outside the memory folder (e.g. ../../dev/rl-team/OPEN_ITEMS.md) are skipped; shared files above cover them.
const names = [...new Set([...text.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)].map((match) => match[1]))]
  .filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name));
for (const name of names) {
  const source = path.join(memoryDir, name);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`linked memory file missing: ${name}`);
  fs.copyFileSync(source, path.join(outDir, name));
}
fs.writeFileSync(path.join(outDir, ".memory-index.json"), JSON.stringify(names), "utf8");
console.log("copied linked memory files", names.length);
