import { spawnSync } from 'node:child_process';

const runTypecheck = (configPath) =>
  spawnSync(
    'npm',
    ['exec', '--yes', '--package', 'typescript', '--', 'tsc', '--noEmit', '-p', configPath],
    { encoding: 'utf8' }
  );

const printResult = (result) => {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
};

const positive = runTypecheck('tsconfig.typecheck.json');
printResult(positive);
if (positive.status !== 0) {
  console.error('Type contract check failed: expected pass fixtures to compile.');
  process.exit(positive.status ?? 1);
}

const negative = runTypecheck('tsconfig.typecheck.fail.json');
printResult(negative);
if (negative.status === 0) {
  console.error('Type contract check failed: expected fail fixtures to report type errors.');
  process.exit(1);
}

console.log('Type contract checks passed: pass fixtures compile and fail fixtures are rejected.');
