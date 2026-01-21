import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const artifactsDirectory = new URL('../artifacts/', import.meta.url);
const reportPath = new URL('../artifacts/npm-audit.json', import.meta.url);

mkdirSync(artifactsDirectory, { recursive: true });

const result = spawnSync('npm', ['audit', '--audit-level=high', '--json'], {
  encoding: 'utf8'
});

const output = `${result.stdout}\n${result.stderr}`.trim();
const isNetworkFailure =
  /ENOTFOUND|EAI_AGAIN|ECONNRESET|audit endpoint returned an error|network/i.test(output);

if (isNetworkFailure) {
  const report = {
    status: 'unavailable',
    reason: 'network_error',
    commandStatus: result.status,
    output
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.warn('Dependency audit skipped due to temporary network failure. See artifacts/npm-audit.json.');
  process.exit(0);
}

let parsed;
if (result.stdout) {
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    parsed = undefined;
  }
}

if (parsed) {
  writeFileSync(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
} else {
  const report = {
    status: result.status === 0 ? 'ok' : 'failed',
    commandStatus: result.status,
    output
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
