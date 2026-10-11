// Compares two result files from run.mjs. Fails (exit code 1) if any puzzle or difficulty check result differs.
// Prints a Markdown report, also appended to the GitHub Actions job summary when available.
//
// Usage: node .github/consistency/compare.mjs <base json> <changed json>
import fs from 'node:fs';

const [basePath, changedPath] = process.argv.slice(2);
if (!basePath || !changedPath) {
  console.error('Usage: node .github/consistency/compare.mjs <base json> <changed json>');
  process.exit(2);
}

const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));
const changed = JSON.parse(fs.readFileSync(changedPath, 'utf8'));

const key = (result) => `${result.board} ${result.difficulty} seed ${result.seed}`;
const changedMap = new Map(changed.map((result) => [key(result), result]));

const mismatches = [];
for (const baseResult of base) {
  const changedResult = changedMap.get(key(baseResult));
  if (!changedResult) {
    mismatches.push(`| ${key(baseResult)} | missing from changed results | |`);
  } else if (baseResult.hash !== changedResult.hash) {
    mismatches.push(`| ${key(baseResult)} | puzzle hash ${baseResult.hash} | ${changedResult.hash} |`);
  } else if (JSON.stringify(baseResult.canSolve) !== JSON.stringify(changedResult.canSolve)) {
    mismatches.push(
      `| ${key(baseResult)} | can solve ${JSON.stringify(baseResult.canSolve)} | ${JSON.stringify(changedResult.canSolve)} |`,
    );
  }
}
if (changed.length !== base.length) {
  mismatches.push(`| (all) | ${base.length} results | ${changed.length} results |`);
}

// Timing per board and difficulty (generation, then the difficulty checks on the generated puzzles)
const totals = new Map();
for (const [results, side] of [
  [base, 'base'],
  [changed, 'changed'],
]) {
  for (const result of results) {
    const groupKey = `${result.board} ${result.difficulty}`;
    const total = totals.get(groupKey) ?? { base: 0, changed: 0, baseCheck: 0, changedCheck: 0 };
    total[side] += result.ms;
    total[`${side}Check`] += result.canSolveMs;
    totals.set(groupKey, total);
  }
}
const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;
const speedup = (before, after) => (after > 0 ? `${(before / after).toFixed(1)}×` : '');

const lines = [];
if (mismatches.length) {
  lines.push(`## ❌ Solutions differ (${mismatches.length} of ${base.length} cases)`);
  lines.push('');
  lines.push('Generated puzzles (or difficulty check results) are not the same as the base for the same seeds.');
  lines.push('');
  lines.push('| Case | Base | Changed |');
  lines.push('| --- | --- | --- |');
  lines.push(...mismatches);
} else {
  lines.push(`## ✅ Same solutions (${base.length} cases)`);
  lines.push('');
  lines.push('Every seeded puzzle, and every difficulty check result on it, matches the base.');
}
lines.push('');
lines.push('### Timing (total over seeds)');
lines.push('');
lines.push('| Board / difficulty | Generation (base) | Generation (changed) | Speedup | Checks (base) | Checks (changed) |');
lines.push('| --- | --- | --- | --- | --- | --- |');
for (const [groupKey, total] of totals) {
  lines.push(
    `| ${groupKey} | ${seconds(total.base)} | ${seconds(total.changed)} | ${speedup(total.base, total.changed)} | ${seconds(total.baseCheck)} | ${seconds(total.changedCheck)} |`,
  );
}
lines.push('');
lines.push('Timing comes from shared CI runners, so treat small differences as noise.');

const report = lines.join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
}

process.exit(mismatches.length ? 1 : 0);
