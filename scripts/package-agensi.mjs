// Builds the Agensi.io listing zip from skill/SKILL.md, which stays the only source of the skill text.
//   pnpm agensi              build .agensi/<name>-<version>.zip and say whether Agensi is behind
//   pnpm agensi --published  record the current skill as the version live on Agensi
//   --check                  print a warning only if Agensi is behind (runs at the end of pnpm build)
// The plugin version is left out of the hash: a release that doesn't change the skill needs no Agensi update.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NAME = "paperclip-scheduled-tasks";
const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = `${root}.agensi`;
const stateFile = `${outDir}/published.sha256`;
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

// Agensi's form reads only single-line values: a `>` folded value shows up as ">".
const LISTING_FIELDS = `summary: Lets agents running in Paperclip schedule one-off work for a later date or time. The task waits in backlog with its assignee set, and the free Scheduled Tasks plugin starts it and wakes the agent when its time comes. Requires the plugin.
tags: [paperclip, scheduling, task-management, agent-orchestration, automation]
keywords: [paperclip, scheduled tasks, one-off tasks, start-at, delayed task, follow-up, reminder, agent scheduling]
use_cases:
  - Schedule a follow-up for a later date, like rotating a key in two weeks
  - Start a review when a trial period ends
  - Have one agent schedule work for another agent
  - Leave a reminder that reaches a person's inbox on a given day
  - Ask a board user to confirm before an agent starts
docs_url: https://github.com/TrasteCC/paperclip-plugin-task-scheduler`;

const REQUIREMENTS = `## Requirements

This skill works only inside [Paperclip](https://github.com/paperclipai/paperclip)
with the free, open-source Scheduled Tasks plugin:

- Paperclip 2026.1023.0 or later, with the plugin installed
  (\`paperclipai plugin install paperclip-plugin-task-scheduler\`) and switched on
  in the company (Company Settings > Plugins > Scheduled Tasks).
- An agent run started by Paperclip, which sets \`PAPERCLIP_API_URL\`,
  \`PAPERCLIP_API_KEY\` and \`PAPERCLIP_TASK_ID\`. Network calls go only to
  \`$PAPERCLIP_API_URL\`. If these variables are not set, tell the user this skill
  needs a Paperclip run, and stop.

Without the plugin, a task with a \`start-at:\` line stays in backlog and never starts.
`;

function render() {
  const source = readFileSync(`${root}skill/SKILL.md`, "utf8");
  const end = source.indexOf("\n---\n", 4);
  const frontmatter = source
    .slice(0, end)
    .replace("name: scheduled-tasks", `name: ${NAME}`)
    .replace(/description: >\n([\s\S]*)/, (_, text) => `description: ${text.trim().replace(/\s+/g, " ")}`);
  const body = source.slice(end).replace("# Scheduled tasks\n", `# Scheduled tasks\n\n${REQUIREMENTS}`);
  return `${frontmatter}\n${LISTING_FIELDS}${body}`;
}

const skill = render();
const hash = createHash("sha256").update(skill).digest("hex");
const published = existsSync(stateFile) ? readFileSync(stateFile, "utf8").trim() : null;
const stale = published !== null && published !== hash;
const staleMessage = "Agensi is behind skill/SKILL.md: run `pnpm agensi`, upload the new version, then `pnpm agensi --published`.";

if (process.argv.includes("--check")) {
  if (stale) console.warn(`WARNING: ${staleMessage}`);
} else if (process.argv.includes("--published")) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(stateFile, `${hash}\n`);
  console.log(`Recorded ${hash} as live on Agensi.`);
} else {
  const zip = `${NAME}-${version}.zip`;
  const skillDir = `${outDir}/${NAME}`;
  rmSync(skillDir, { recursive: true, force: true });
  rmSync(`${outDir}/${zip}`, { force: true });
  mkdirSync(skillDir, { recursive: true });
  // Added here, not in render(), so a version bump alone doesn't change the hash.
  writeFileSync(`${skillDir}/SKILL.md`, skill.replace("\ntags: ", `\nversion: ${version}\ntags: `));
  execFileSync("zip", ["-X", "-q", "-r", zip, NAME], { cwd: outDir });
  console.log(`Built .agensi/${zip}`);
  console.log(published === null ? "Not published yet." : stale ? staleMessage : "Agensi is up to date.");
}
