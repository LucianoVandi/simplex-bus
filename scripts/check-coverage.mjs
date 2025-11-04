import { spawnSync } from 'node:child_process';

const thresholds = {
  line: 90,
  branch: 85,
  funcs: 90
};

const result = spawnSync('node', ['--test', '--experimental-test-coverage'], {
  encoding: 'utf8'
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const stripAnsi = (value) => value.replace(/\u001b\[[0-9;]*m/g, '');

const parseCoverageSummary = (stdout) => {
  const normalized = stripAnsi(stdout);
  const lines = normalized.split(/\r?\n/);
  const summaryRow = lines.find((line) => /^\s*[|ℹ]?\s*all files\s*\|/i.test(line));

  if (!summaryRow) {
    return null;
  }

  const cells = summaryRow
    .replace(/^\s*[|ℹ]\s*/, '')
    .split('|')
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);

  if (cells.length < 4) {
    return null;
  }

  const [line, branch, funcs] = cells.slice(1, 4).map(Number);
  if ([line, branch, funcs].some((value) => Number.isNaN(value))) {
    return null;
  }

  return { line, branch, funcs };
};

const parsedCoverage = parseCoverageSummary(result.stdout);

if (!parsedCoverage) {
  console.error('Coverage summary row for "all files" not found.');
  process.exit(1);
}

const { line, branch, funcs } = parsedCoverage;

const failures = [];
if (line < thresholds.line) {
  failures.push(`line ${line.toFixed(2)}% < ${thresholds.line}%`);
}
if (branch < thresholds.branch) {
  failures.push(`branch ${branch.toFixed(2)}% < ${thresholds.branch}%`);
}
if (funcs < thresholds.funcs) {
  failures.push(`funcs ${funcs.toFixed(2)}% < ${thresholds.funcs}%`);
}

if (failures.length > 0) {
  console.error(`Coverage check failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(
  `Coverage check passed: line ${line.toFixed(2)}%, branch ${branch.toFixed(2)}%, funcs ${funcs.toFixed(2)}%.`
);
