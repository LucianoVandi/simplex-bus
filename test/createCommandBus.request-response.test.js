import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBusAbortedError,
  CommandBusSerializationError,
  CommandBusRemoteError,
  CommandBusTimeoutError,
  createCommandBus
} from '../index.js';
import { createLinkedBuses } from '../fixtures/helpers/createLinkedBuses.js';

test('send/receive dispatches payload to registered handler', () => {
  const received = [];

  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  bus.on('ping', (payload) => {
    received.push(payload);
  });

  bus.send('ping', { ok: true });

  assert.deepEqual(received, [{ ok: true }]);
});

test('request/response works even when allowedTypes excludes response types', async () => {
  const { busA, busB } = createLinkedBuses(
    { allowedTypes: ['get-token'] },
    { allowedTypes: ['get-token'] }
  );

  busB.on('get-token', (_, context) => {
    context.respond('abc123');
  });

  const token = await busA.request('get-token', undefined, 100);
  assert.equal(token, 'abc123');
});

test('request rejects with timeout when no response is received', async () => {
  const bus = createCommandBus({
    sendFn: () => {}
  });

  await assert.rejects(() => bus.request('missing', undefined, 25), CommandBusTimeoutError);
});

test('request supports AbortSignal', async () => {
  const bus = createCommandBus({
    sendFn: () => {}
  });

  const controller = new AbortController();
  const promise = bus.request('long-op', undefined, { timeout: 1000, signal: controller.signal });
  controller.abort();

  await assert.rejects(() => promise, CommandBusAbortedError);
});

test('request rejects untrusted responses through isTrustedResponse guard', async () => {
  const logs = [];
  const { busA, busB } = createLinkedBuses(
    {
      logger: { error: (...args) => logs.push(args) },
      isTrustedResponse: () => false
    },
    {}
  );

  busB.on('secure', (_, context) => {
    context.respond({ token: 'accepted' });
  });

  await assert.rejects(
    () => busA.request('secure', undefined, 25),
    (error) => error instanceof CommandBusTimeoutError
  );

  assert.equal(logs.length > 0, true);
  assert.equal(logs.some((entry) => String(entry[0]).includes('Dropped untrusted response')), true);
});

test('strict response trust mode rejects spoofed response missing nonce', async () => {
  const logs = [];
  let capturedRequest;

  const bus = createCommandBus({
    sendFn: (message) => {
      capturedRequest = JSON.parse(message);
    },
    responseTrustMode: 'strict',
    logger: { error: (...args) => logs.push(args) }
  });

  const pending = bus.request('secure', undefined, 25);
  bus.receive(
    JSON.stringify({
      type: 'secure-response',
      id: capturedRequest.id,
      payload: { token: 'spoofed' }
    })
  );

  await assert.rejects(() => pending, CommandBusTimeoutError);
  assert.equal(logs.some((entry) => String(entry[0]).includes('invalid nonce')), true);
});

test('permissive response trust mode keeps compatibility with legacy responders', async () => {
  let capturedRequest;
  const bus = createCommandBus({
    responseTrustMode: 'permissive',
    sendFn: (message) => {
      capturedRequest = JSON.parse(message);
      bus.receive(
        JSON.stringify({
          type: 'legacy-response',
          id: capturedRequest.id,
          payload: { ok: true }
        })
      );
    }
  });

  const response = await bus.request('legacy', undefined, 50);
  assert.deepEqual(response, { ok: true });
});

test('request id generation falls back when crypto.randomUUID is unavailable', async () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;
  const fallbackCrypto = {
    ...originalCrypto,
    randomUUID: undefined,
    getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
  };

  Object.defineProperty(globalThis, 'crypto', {
    value: fallbackCrypto,
    configurable: true
  });

  let capturedRequestId;
  const bus = createCommandBus({
    sendFn: (message) => {
      capturedRequestId = JSON.parse(message).id;
    }
  });

  try {
    await assert.rejects(() => bus.request('id-check', undefined, 0), CommandBusTimeoutError);
    assert.match(capturedRequestId, /^cmd-[0-9a-f]{32}-1$/);
  } finally {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true
      });
    }
  }
});

test('remote errors are propagated as CommandBusRemoteError', async () => {
  const { busA, busB } = createLinkedBuses();

  busB.on('save', (_, context) => {
    context.respondError({ code: 'E_SAVE', message: 'cannot persist' });
  });

  await assert.rejects(
    () => busA.request('save', { id: 1 }, 100),
    (error) => error instanceof CommandBusRemoteError && error.payload.code === 'E_SAVE'
  );
});

test('request rejects when sendFn fails during envelope dispatch', async () => {
  const bus = createCommandBus({
    sendFn: () => {
      throw new Error('transport down');
    }
  });

  await assert.rejects(
    () => bus.request('send-fail', { ok: true }, 100),
    (error) => error instanceof Error && error.message === 'transport down'
  );
});

test('request rejects when serializer fails during envelope dispatch', async () => {
  const bus = createCommandBus({
    serializer: () => {
      throw new Error('cannot serialize');
    },
    sendFn: () => {}
  });

  await assert.rejects(() => bus.request('serialize-fail', { ok: true }, 100), CommandBusSerializationError);
});
