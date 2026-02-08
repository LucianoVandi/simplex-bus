import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBusRemoteError,
  CommandBusTimeoutError,
  CommandBusInvalidMessageError,
  CommandBusLimitError,
  CommandBusSerializationError,
  CommandBusValidationError,
  CommandBusDisposedError,
  createCommandBus
} from '../index.js';
import { createLinkedBuses } from '../fixtures/helpers/createLinkedBuses.js';

test('validator is applied for send and receive paths', () => {
  const validator = {
    ping: (payload) => payload && payload.valid === true
  };

  const bus = createCommandBus({
    validators: validator,
    sendFn: (message) => bus.receive(message)
  });

  assert.throws(() => bus.send('ping', { valid: false }), CommandBusValidationError);

  const seen = [];
  bus.on('ping', (payload) => seen.push(payload));
  bus.receive(JSON.stringify({ type: 'ping', payload: { valid: false } }));
  bus.send('ping', { valid: true });

  assert.deepEqual(seen, [{ valid: true }]);
});

test('constructor validates required config types', () => {
  assert.throws(() => createCommandBus({}), /sendFn/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, onReceive: 1 }), /onReceive/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, allowedTypes: 'x' }), /allowedTypes/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, validators: null }), /validators/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, parser: 1 }), /parser/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, serializer: 1 }), /serializer/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, responseSuffix: '' }), /responseSuffix/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, maxIncomingMessageBytes: 0 }), /maxIncomingMessageBytes/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, maxPendingRequests: 0 }), /maxPendingRequests/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, responseTrustMode: 'unknown' }), /responseTrustMode/);
  assert.throws(() => createCommandBus({ sendFn: () => {}, isTrustedResponse: 'nope' }), /isTrustedResponse/);
});

test('on/once/off validate arguments', () => {
  const bus = createCommandBus({ sendFn: () => {} });
  assert.throws(() => bus.on('', () => {}), /type/);
  assert.throws(() => bus.on('x', 'nope'), /handler/);
  assert.throws(() => bus.once('x', 'nope'), /handler/);
  assert.throws(() => bus.off(''), /type/);
  assert.equal(bus.off('missing'), false);
});

test('send validates type and allowed types', () => {
  const bus = createCommandBus({ sendFn: () => {}, allowedTypes: ['ok'] });
  assert.throws(() => bus.send(''), /type/);
  assert.throws(() => bus.send('nope'), CommandBusValidationError);
});

test('request validates type, timeout and signal', async () => {
  const bus = createCommandBus({ sendFn: () => {} });
  assert.throws(() => bus.request('x', undefined, -1), /timeout/);
  assert.throws(() => bus.request('', undefined, 1), /type/);
  assert.throws(() => bus.request('x', undefined, 'not-valid-options'), /number or an object/);
  assert.throws(() => bus.request('x', undefined, { signal: {} }), /AbortSignal/);
});

test('invalid incoming message is reported to logger', () => {
  const logs = [];
  const bus = createCommandBus({
    sendFn: () => {},
    logger: { error: (...args) => logs.push(args) }
  });

  bus.receive('not-json');
  bus.receive(JSON.stringify({}));
  bus.receive(JSON.stringify({ type: 'x', id: '' }));

  assert.equal(logs.length, 3);
  assert.ok(logs[0][1] instanceof Error);
});

test('receive ignores commands with disallowed types', () => {
  let count = 0;
  const bus = createCommandBus({
    sendFn: () => {},
    allowedTypes: ['allowed']
  });
  bus.on('allowed', () => {
    count += 1;
  });
  bus.receive(JSON.stringify({ type: 'blocked', payload: 1 }));
  assert.equal(count, 0);
});

test('serializer errors are wrapped', () => {
  const bus = createCommandBus({
    sendFn: () => {},
    serializer: () => {
      throw new Error('broken');
    }
  });

  assert.throws(() => bus.send('x', {}), CommandBusSerializationError);
});

test('validators must be functions when used', () => {
  const bus = createCommandBus({
    sendFn: () => {},
    validators: { x: 'bad' }
  });

  assert.throws(() => bus.send('x', {}), CommandBusValidationError);
});

test('validator failures are wrapped when validator throws', () => {
  const bus = createCommandBus({
    sendFn: () => {},
    validators: {
      explode: () => {
        throw new Error('validator crash');
      }
    }
  });

  assert.throws(
    () => bus.send('explode', {}),
    (error) =>
      error instanceof CommandBusValidationError &&
      error.message.includes('Validator failed for type "explode"')
  );
});

test('handler exceptions are logged and converted to error responses', async () => {
  const logs = [];
  const { busA, busB } = createLinkedBuses(
    {},
    { logger: { error: (...args) => logs.push(args) } }
  );

  busB.on('explode', () => {
    throw new Error('boom');
  });

  await assert.rejects(
    () => busA.request('explode', undefined, 100),
    (error) => error instanceof CommandBusRemoteError && error.payload.message === 'boom'
  );
  assert.equal(logs.length > 0, true);
});

test('async handler rejections are logged and converted to error responses', async () => {
  const logs = [];
  const { busA, busB } = createLinkedBuses(
    {},
    { logger: { error: (...args) => logs.push(args) } }
  );

  busB.on('explode-async', async () => {
    throw new Error('async boom');
  });

  await assert.rejects(
    () => busA.request('explode-async', undefined, 100),
    (error) => error instanceof CommandBusRemoteError && error.payload.message === 'async boom'
  );
  assert.equal(logs.length > 0, true);
});

test('async listeners execute independently without blocking other listeners', async () => {
  const events = [];
  let releaseSlowListener;
  const slowListenerDone = new Promise((resolve) => {
    releaseSlowListener = resolve;
  });

  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message),
    logger: { error: () => {} }
  });

  bus.on('parallel', async () => {
    events.push('slow:start');
    await slowListenerDone;
    events.push('slow:end');
  });
  bus.on('parallel', () => {
    events.push('fast');
  });

  bus.send('parallel');
  assert.deepEqual(events, ['slow:start', 'fast']);

  releaseSlowListener();
  await Promise.resolve();
  assert.deepEqual(events, ['slow:start', 'fast', 'slow:end']);
});

test('handler registration fails when type is not in allowedTypes', () => {
  const bus = createCommandBus({
    sendFn: () => {},
    allowedTypes: ['allowed']
  });

  assert.throws(() => bus.on('blocked', () => {}), CommandBusValidationError);
});

test('context.respond returns false when incoming message has no request id', () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  let responded = true;
  bus.on('ping', (_, context) => {
    responded = context.respond({ ok: true });
  });

  bus.send('ping');
  assert.equal(responded, false);
});

test('failed handler error-response send is logged and requester times out', async () => {
  const logs = [];
  const { busA, busB } = createLinkedBuses(
    {},
    {
      logger: { error: (...args) => logs.push(args) },
      validators: {
        'explode-response': () => false
      }
    }
  );

  busB.on('explode', () => {
    throw new Error('boom');
  });

  await assert.rejects(() => busA.request('explode', undefined, 25), CommandBusTimeoutError);
  assert.equal(logs.some((entry) => String(entry[0]).includes('Failed to send handler error response')), true);
});

test('CommandBusInvalidMessageError can be created explicitly', () => {
  const error = new CommandBusInvalidMessageError('bad');
  assert.equal(error.message, 'bad');
});

test('invalid nonce in incoming message is reported to logger', () => {
  const logs = [];
  const bus = createCommandBus({
    sendFn: () => {},
    logger: { error: (...args) => logs.push(args) }
  });

  bus.receive(JSON.stringify({ type: 'x', nonce: '' }));
  assert.equal(logs.length, 1);
  assert.ok(logs[0][1] instanceof Error);
});

test('maxIncomingMessageBytes drops oversized messages', () => {
  const logs = [];
  let called = 0;
  const bus = createCommandBus({
    sendFn: () => {},
    maxIncomingMessageBytes: 10,
    logger: { error: (...args) => logs.push(args) }
  });

  bus.on('ping', () => {
    called += 1;
  });

  bus.receive('{"type":"ping","payload":"this payload is too long"}');
  assert.equal(called, 0);
  assert.equal(logs.length, 1);
});

test('maxIncomingMessageBytes uses UTF-8 byte size, not character count', () => {
  const logs = [];
  let called = 0;
  const bus = createCommandBus({
    sendFn: () => {},
    maxIncomingMessageBytes: 16,
    logger: { error: (...args) => logs.push(args) }
  });

  bus.on('x', () => {
    called += 1;
  });

  // "😀" is 4 bytes in UTF-8. This payload crosses 16 bytes quickly.
  bus.receive(JSON.stringify({ type: 'x', payload: '😀😀😀😀😀' }));
  assert.equal(called, 0);
  assert.equal(logs.length, 1);
});

test('maxPendingRequests protects from unbounded pending growth', async () => {
  const bus = createCommandBus({
    sendFn: () => {},
    maxPendingRequests: 1
  });

  const pending = bus.request('first', undefined, 1000);
  assert.throws(() => bus.request('second', undefined, 1000), CommandBusLimitError);

  bus.dispose();
  await assert.rejects(() => pending, CommandBusDisposedError);
});

test('receive is a no-op after dispose', () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  let called = 0;
  bus.on('x', () => {
    called += 1;
  });

  bus.dispose();
  bus.receive(JSON.stringify({ type: 'x', payload: 1 }));
  assert.equal(called, 0);
});

test('receive is robust against malformed random inputs (fuzz smoke)', () => {
  const bus = createCommandBus({
    sendFn: () => {},
    logger: { error: () => {} }
  });

  const randomValues = [
    null,
    undefined,
    true,
    0,
    NaN,
    '',
    '{',
    '[]',
    '"text"',
    '{}',
    '{"type":""}',
    '{"id":123}',
    [],
    {},
    { type: '' },
    { type: 'ok', id: '' },
    { type: 'ok', payload: { a: 1 } }
  ];

  for (let i = 0; i < 500; i += 1) {
    const value = randomValues[i % randomValues.length];
    assert.doesNotThrow(() => bus.receive(value));
  }
});

test('handler error for non-request message is logged without sending an error response', () => {
  const logs = [];
  let sent = 0;
  const bus = createCommandBus({
    logger: { error: (...args) => logs.push(args) },
    sendFn: () => {
      sent += 1;
    }
  });

  bus.on('explode', () => {
    throw new Error('no-request boom');
  });

  bus.receive(JSON.stringify({ type: 'explode', payload: { ok: false } }));
  assert.equal(sent, 0);
  assert.equal(logs.length, 1);
  assert.equal(String(logs[0][0]).includes('Handler failed for type "explode"'), true);
});
