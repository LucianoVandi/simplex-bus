import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dts = readFileSync(new URL('../index.d.ts', import.meta.url), 'utf8');

test('index.d.ts exports core API signatures (contract smoke)', () => {
  const requiredSignatures = [
    'export interface CreateCommandBusConfig',
    'maxIncomingMessageBytes?: number;',
    'maxPendingRequests?: number;',
    'export interface CommandBus',
    'send(type: string, payload?: unknown): void;',
    'request(type: string, payload?: unknown, timeout?: number): Promise<unknown>;',
    'export function createCommandBus(config: CreateCommandBusConfig): CommandBus;',
    'export function createSchemaValidators(',
    'export class CommandBusLimitError extends CommandBusError {}'
  ];

  for (const signature of requiredSignatures) {
    assert.equal(dts.includes(signature), true, `Missing declaration contract: ${signature}`);
  }
});

test('index.d.ts includes schema diagnostics hook contract', () => {
  assert.equal(dts.includes('onValidationError?: (details:'), true);
  assert.equal(dts.includes("channel: 'request' | 'response' | 'error';"), true);
});
