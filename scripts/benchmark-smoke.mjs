import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

import { createCommandBus } from '../index.js';

const baselinePath = new URL('../fixtures/benchmarks/smoke-baseline.json', import.meta.url);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const warmupSendIterations = 2000;
const measuredSendIterations = 20000;
const warmupRequestIterations = 200;
const measuredRequestIterations = 2000;

const toOpsPerSec = ({ iterations, elapsedMs }) => (iterations / elapsedMs) * 1000;

const createLinkedBuses = () => {
  let busA;
  let busB;

  busA = createCommandBus({
    sendFn: (message) => busB.receive(message)
  });

  busB = createCommandBus({
    sendFn: (message) => busA.receive(message)
  });

  return { busA, busB };
};

const measureSendLoopback = () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  bus.on('ping', () => {});

  for (let index = 0; index < warmupSendIterations; index += 1) {
    bus.send('ping', index);
  }

  const start = performance.now();
  for (let index = 0; index < measuredSendIterations; index += 1) {
    bus.send('ping', index);
  }
  const elapsedMs = performance.now() - start;

  return toOpsPerSec({ iterations: measuredSendIterations, elapsedMs });
};

const measureRequestResponse = async () => {
  const { busA, busB } = createLinkedBuses();

  busB.on('echo', (payload, context) => {
    context.respond(payload);
  });

  for (let index = 0; index < warmupRequestIterations; index += 1) {
    await busA.request('echo', { index }, { timeout: 100 });
  }

  const start = performance.now();
  for (let index = 0; index < measuredRequestIterations; index += 1) {
    await busA.request('echo', { index }, { timeout: 100 });
  }
  const elapsedMs = performance.now() - start;

  busA.dispose();
  busB.dispose();

  return toOpsPerSec({ iterations: measuredRequestIterations, elapsedMs });
};

const assertBaseline = ({ metricName, measuredValue, baselineValue }) => {
  if (measuredValue < baselineValue) {
    throw new Error(
      `Benchmark regression for ${metricName}: measured ${measuredValue.toFixed(2)} ops/s, baseline ${baselineValue.toFixed(2)} ops/s.`
    );
  }
};

const run = async () => {
  const sendLoopbackOpsPerSec = measureSendLoopback();
  const requestResponseOpsPerSec = await measureRequestResponse();

  console.log('Benchmark smoke results:');
  console.log(`- send loopback: ${sendLoopbackOpsPerSec.toFixed(2)} ops/s`);
  console.log(`- request/response: ${requestResponseOpsPerSec.toFixed(2)} ops/s`);

  assertBaseline({
    metricName: 'send_loopback_ops_per_sec',
    measuredValue: sendLoopbackOpsPerSec,
    baselineValue: baseline.send_loopback_ops_per_sec
  });
  assertBaseline({
    metricName: 'request_response_ops_per_sec',
    measuredValue: requestResponseOpsPerSec,
    baselineValue: baseline.request_response_ops_per_sec
  });

  console.log('Benchmark smoke passed baseline thresholds.');
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
