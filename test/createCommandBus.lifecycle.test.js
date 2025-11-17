import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CommandBusDisposedError,
  createCommandBus
} from '../index.js';

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
