import test from 'node:test';
import assert from 'node:assert/strict';

import { CommandBusTimeoutError, createCommandBus } from '../index.js';

const createLinkedWindows = () => {
  const listenersA = new Set();
  const listenersB = new Set();
  const emitMessage = (targetListeners, event) => {
    for (const listener of targetListeners) {
      listener(event);
    }
  };

  const windowA = {
    origin: 'https://a.example',
    addEventListener: (type, listener) => {
      if (type === 'message') {
        listenersA.add(listener);
      }
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') {
        listenersA.delete(listener);
      }
    },
    postMessageTo: (targetWindow, data) =>
      emitMessage(targetWindow === windowB ? listenersB : listenersA, {
        data,
        origin: windowA.origin,
        source: windowA
      })
  };

  const windowB = {
    origin: 'https://b.example',
    addEventListener: (type, listener) => {
      if (type === 'message') {
        listenersB.add(listener);
      }
    },
    removeEventListener: (type, listener) => {
      if (type === 'message') {
        listenersB.delete(listener);
      }
    },
    postMessageTo: (targetWindow, data) =>
      emitMessage(targetWindow === windowA ? listenersA : listenersB, {
        data,
        origin: windowB.origin,
        source: windowB
      })
  };

  return { windowA, windowB };
};

const createPostMessageBus = ({
  selfWindow,
  targetWindow,
  responseTrustMode = 'auto',
  isTrustedResponse
}) =>
  createCommandBus({
    sendFn: (message) => selfWindow.postMessageTo(targetWindow, message),
    onReceive: (handler) => {
      const listener = (event) => {
        handler({
          ...JSON.parse(event.data),
          _origin: event.origin,
          _source: event.source
        });
      };
      selfWindow.addEventListener('message', listener);
      return () => selfWindow.removeEventListener('message', listener);
    },
    responseTrustMode,
    isTrustedResponse
  });

test('transport integration: auto trust mode accepts trusted origin/source response', async () => {
  const { windowA, windowB } = createLinkedWindows();

  const busA = createPostMessageBus({
    selfWindow: windowA,
    targetWindow: windowB,
    responseTrustMode: 'auto',
    isTrustedResponse: ({ raw }) =>
      raw &&
      typeof raw === 'object' &&
      raw._origin === 'https://b.example' &&
      raw._source === windowB
  });

  const busB = createPostMessageBus({
    selfWindow: windowB,
    targetWindow: windowA,
    responseTrustMode: 'auto',
    isTrustedResponse: () => true
  });

  busB.on('echo', (payload, context) => {
    context.respond({ ok: true, payload });
  });

  const response = await busA.request('echo', { value: 42 }, 100);
  assert.deepEqual(response, { ok: true, payload: { value: 42 } });
});

test('transport integration: strict mode rejects spoofed response without nonce', async () => {
  let requestEnvelope;
  const controlledBus = createCommandBus({
    sendFn: (message) => {
      requestEnvelope = JSON.parse(message);
    },
    responseTrustMode: 'strict',
    isTrustedResponse: () => true
  });

  const pending = controlledBus.request('secure', undefined, 25);
  controlledBus.receive({
    type: 'secure-response',
    id: requestEnvelope.id,
    payload: { token: 'spoofed' }
  });

  await assert.rejects(() => pending, CommandBusTimeoutError);
  controlledBus.dispose();
});

test('transport integration: permissive mode accepts legacy response without nonce', async () => {
  let requestEnvelope;
  const bus = createCommandBus({
    sendFn: (message) => {
      requestEnvelope = JSON.parse(message);
      bus.receive({
        type: 'legacy-response',
        id: requestEnvelope.id,
        payload: { ok: true }
      });
    },
    responseTrustMode: 'permissive',
    isTrustedResponse: () => true
  });

  const response = await bus.request('legacy', undefined, 50);
  assert.deepEqual(response, { ok: true });
});
