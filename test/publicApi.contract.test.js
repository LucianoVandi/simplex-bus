import test from 'node:test';
import assert from 'node:assert/strict';

import * as PublicApi from '../index.js';

const expectedExports = [
  'createCommandBus',
  'createSchemaValidators',
  'CommandBusError',
  'CommandBusDisposedError',
  'CommandBusValidationError',
  'CommandBusSerializationError',
  'CommandBusInvalidMessageError',
  'CommandBusTimeoutError',
  'CommandBusAbortedError',
  'CommandBusRemoteError',
  'CommandBusLimitError'
];

test('public exports contract is stable', () => {
  for (const name of expectedExports) {
    assert.equal(name in PublicApi, true, `Missing export: ${name}`);
  }
});

test('createCommandBus returns stable public method surface', () => {
  const bus = PublicApi.createCommandBus({ sendFn: () => {} });

  const methodNames = ['send', 'request', 'receive', 'on', 'once', 'off', 'dispose'];
  for (const methodName of methodNames) {
    assert.equal(typeof bus[methodName], 'function', `Missing method ${methodName}`);
  }
});

test('error classes extend Error and keep names', () => {
  const errorClassNames = [
    'CommandBusError',
    'CommandBusDisposedError',
    'CommandBusValidationError',
    'CommandBusSerializationError',
    'CommandBusInvalidMessageError',
    'CommandBusTimeoutError',
    'CommandBusAbortedError',
    'CommandBusRemoteError',
    'CommandBusLimitError'
  ];

  for (const className of errorClassNames) {
    const ErrorClass = PublicApi[className];
    const instance =
      className === 'CommandBusTimeoutError'
        ? new ErrorClass('type-a', 100)
        : className === 'CommandBusAbortedError'
          ? new ErrorClass('type-a')
          : className === 'CommandBusRemoteError'
            ? new ErrorClass('type-a', { code: 'ERR' })
            : new ErrorClass('message');

    assert.equal(instance instanceof Error, true, `${className} is not an Error`);
    assert.equal(instance.name, className, `${className} has unexpected name`);
  }
});

test('createSchemaValidators returns validator map keyed by request and response type', () => {
  const validators = PublicApi.createSchemaValidators({
    schemaMap: {
      ping: {
        request: { type: 'object', required: ['value'] },
        response: { type: 'object', required: ['value'] }
      }
    },
    compile: () => () => true
  });

  assert.equal(typeof validators.ping, 'function');
  assert.equal(typeof validators['ping-response'], 'function');
});
