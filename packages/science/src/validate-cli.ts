import { validateSeeds } from "./validate.js";

// E1.4 CLI — `pnpm --filter @myoadapt/science validate`. Exits non-zero on any
// problem so it can gate CI before the seed pipeline runs.
const result = validateSeeds();

if (result.ok) {
  const s = result.seeds!;
  console.log(
    `✓ seeds valid — ${s.muscles.length} muscles, ${s.equipment.length} equipment, ` +
      `${s.joints.length} joints, ${s.exercises.length} exercises, ${s.ruleSets.length} rule set(s)`
  );
  process.exit(0);
}

console.error(`✗ ${result.problems.length} validation problem(s):`);
for (const p of result.problems) console.error(`  - ${p}`);
process.exit(1);
