import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';

import { createCommandBus } from '../index.js';

const baselinePath = new URL('../fixtures/benchmarks/smoke-baseline.json', import.meta.url);
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const warmupSendIterations = 2000;
const measuredSendIterations = 20000;
const warmupRequestIterations = 200;
const measuredRequestIterations = 2000;
const warmupDispatchIterations = 1000;
const measuredDispatchIterations = 10000;
const samplesPerMetric = 3;

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

const measureDispatchWithValidation = () => {
  const bus = createCommandBus({
    validators: {
      ping: (payload) => payload && typeof payload.index === 'number'
    },
    sendFn: (message) => bus.receive(message)
  });

  bus.on('ping', () => {});

  for (let index = 0; index < warmupDispatchIterations; index += 1) {
    bus.send('ping', { index });
  }

  const start = performance.now();
  for (let index = 0; index < measuredDispatchIterations; index += 1) {
    bus.send('ping', { index });
  }
  const elapsedMs = performance.now() - start;

  return toOpsPerSec({ iterations: measuredDispatchIterations, elapsedMs });
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

const getMedian = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted[middle];
};

const measureMetric = async (measureFn) => {
  const values = [];
  for (let sample = 0; sample < samplesPerMetric; sample += 1) {
    values.push(await measureFn());
  }
  return {
    samples: values,
    median: getMedian(values)
  };
};

const assertBaseline = ({ metricName, measuredValue, baselineValue }) => {
  if (measuredValue < baselineValue) {
    throw new Error(
      `Benchmark regression for ${metricName}: measured ${measuredValue.toFixed(2)} ops/s, baseline ${baselineValue.toFixed(2)} ops/s.`
    );
  }
};

const run = async () => {
  const sendLoopback = await measureMetric(async () => measureSendLoopback());
  const requestResponse = await measureMetric(measureRequestResponse);
  const dispatchWithValidation = await measureMetric(async () => measureDispatchWithValidation());

  console.log('Benchmark smoke results:');
  console.log(
    `- send loopback (median): ${sendLoopback.median.toFixed(2)} ops/s | samples ${sendLoopback.samples.map((value) => value.toFixed(2)).join(', ')}`
  );
  console.log(
    `- request/response (median): ${requestResponse.median.toFixed(2)} ops/s | samples ${requestResponse.samples.map((value) => value.toFixed(2)).join(', ')}`
  );
  console.log(
    `- dispatch with validation (median): ${dispatchWithValidation.median.toFixed(2)} ops/s | samples ${dispatchWithValidation.samples.map((value) => value.toFixed(2)).join(', ')}`
  );

  assertBaseline({
    metricName: 'send_loopback_ops_per_sec',
    measuredValue: sendLoopback.median,
    baselineValue: baseline.send_loopback_ops_per_sec
  });
  assertBaseline({
    metricName: 'request_response_ops_per_sec',
    measuredValue: requestResponse.median,
    baselineValue: baseline.request_response_ops_per_sec
  });
  assertBaseline({
    metricName: 'dispatch_with_validation_ops_per_sec',
    measuredValue: dispatchWithValidation.median,
    baselineValue: baseline.dispatch_with_validation_ops_per_sec
  });

  console.log('Benchmark smoke passed baseline thresholds.');
};

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
