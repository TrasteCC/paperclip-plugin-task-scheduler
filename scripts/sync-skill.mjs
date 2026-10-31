// Regenerates src/skill.ts from skill/SKILL.md (the readable source). Run: pnpm sync-skill
import { readFileSync, writeFileSync } from "node:fs";
const md = readFileSync(new URL("../skill/SKILL.md", import.meta.url), "utf8");
writeFileSync(
  new URL("../src/skill.ts", import.meta.url),
  `// Generated from skill/SKILL.md by \`pnpm sync-skill\`. Do not edit by hand.\nexport const SKILL_MARKDOWN = ${JSON.stringify(md)};\n`,
);
