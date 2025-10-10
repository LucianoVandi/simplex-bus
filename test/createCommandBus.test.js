import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBusAbortedError,
  CommandBusDisposedError,
  CommandBusInvalidMessageError,
  CommandBusLimitError,
  CommandBusRemoteError,
  CommandBusSerializationError,
  CommandBusTimeoutError,
  CommandBusValidationError,
  createSchemaValidators,
  createCommandBus
} from '../index.js';

function createLinkedBuses(configA = {}, configB = {}) {
  let busA;
  let busB;

  busA = createCommandBus({
    ...configA,
    sendFn: (message) => busB.receive(message)
  });

  busB = createCommandBus({
    ...configB,
    sendFn: (message) => busA.receive(message)
  });

  return { busA, busB };
}

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

  assert.deepEqual(seen, []);
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

test('once handler runs only one time', () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  let count = 0;
  bus.once('ping', () => {
    count += 1;
  });

  bus.send('ping');
  bus.send('ping');

  assert.equal(count, 1);
});

test('off removes specific handler', () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });

  let count = 0;
  const handler = () => {
    count += 1;
  };

  bus.on('event', handler);
  bus.off('event', handler);
  bus.send('event');

  assert.equal(count, 0);
});

test('dispose rejects pending requests and forbids further usage', async () => {
  const bus = createCommandBus({
    sendFn: () => {}
  });

  const pending = bus.request('slow-op', undefined, 1000);
  bus.dispose();

  await assert.rejects(() => pending, CommandBusDisposedError);
  assert.throws(() => bus.send('anything'), CommandBusDisposedError);
});

test('dispose invokes unsubscribe returned by onReceive', () => {
  let called = 0;

  const bus = createCommandBus({
    sendFn: () => {},
    onReceive: () => () => {
      called += 1;
    }
  });

  bus.dispose();
  assert.equal(called, 1);
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

test('off without handler removes all listeners for that type', () => {
  const bus = createCommandBus({
    sendFn: (message) => bus.receive(message)
  });
  let count = 0;
  bus.on('multi', () => {
    count += 1;
  });
  bus.on('multi', () => {
    count += 1;
  });
  assert.equal(bus.off('multi'), true);
  bus.send('multi');
  assert.equal(count, 0);
});

test('dispose is idempotent', () => {
  let unsubscribed = 0;
  const bus = createCommandBus({
    sendFn: () => {},
    onReceive: () => () => {
      unsubscribed += 1;
    }
  });
  bus.dispose();
  bus.dispose();
  assert.equal(unsubscribed, 1);
});

test('CommandBusInvalidMessageError can be created explicitly', () => {
  const error = new CommandBusInvalidMessageError('bad');
  assert.equal(error.message, 'bad');
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

test('createSchemaValidators builds request and response validators', () => {
  const compile = (schema) => {
    if (schema.type === 'string') {
      return (payload) => typeof payload === 'string';
    }

    if (schema.type === 'object' && schema.required?.includes('token')) {
      return (payload) =>
        payload && typeof payload === 'object' && typeof payload.token === 'string';
    }

    if (schema.type === 'object' && schema.required?.includes('message')) {
      return (payload) =>
        payload && typeof payload === 'object' && typeof payload.message === 'string';
    }

    return () => false;
  };

  const validators = createSchemaValidators({
    compile,
    schemaMap: {
      'auth/get-token': {
        request: { type: 'string' },
        response: { type: 'object', required: ['token'] },
        error: { type: 'object', required: ['message'] }
      }
    }
  });

  assert.equal(validators['auth/get-token']('x'), true);
  assert.equal(validators['auth/get-token-response']({ token: 'abc' }), true);
  assert.equal(validators['auth/get-token-response']({ message: 'oops' }), true);
  assert.throws(
    () => validators['auth/get-token-response']({ invalid: true }),
    CommandBusValidationError
  );
});

test('createSchemaValidators validates config', () => {
  assert.throws(() => createSchemaValidators({ compile: () => () => true }), /schemaMap/);
  assert.throws(() => createSchemaValidators({ schemaMap: {}, compile: 1 }), /compile/);
  assert.throws(
    () => createSchemaValidators({ schemaMap: {}, compile: () => () => true, onValidationError: 1 }),
    /onValidationError/
  );
});

test('createSchemaValidators surfaces validation diagnostics', () => {
  const diagnostics = [];
  const compile = () => {
    const fn = () => false;
    fn.errors = [{ path: '/token', message: 'required' }];
    return fn;
  };

  const validators = createSchemaValidators({
    compile,
    onValidationError: (details) => diagnostics.push(details),
    schemaMap: {
      'auth/get-token': {
        response: { type: 'object', required: ['token'] }
      }
    }
  });

  assert.throws(
    () => validators['auth/get-token-response']({}),
    (error) =>
      error instanceof CommandBusValidationError &&
      error.details &&
      error.details.type === 'auth/get-token' &&
      error.details.channel === 'response'
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].channel, 'response');
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
