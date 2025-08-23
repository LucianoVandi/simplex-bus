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

const match = result.stdout.match(/all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/i);

if (!match) {
  console.error('Coverage summary row for "all files" not found.');
  process.exit(1);
}

const [line, branch, funcs] = match.slice(1).map(Number);

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
