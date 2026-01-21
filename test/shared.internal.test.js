import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRandomHex,
  getStringSizeInBytes
} from '../src/internal/shared.js';

test('getRandomHex returns expected hex length when crypto.getRandomValues is available', async () => {
  const value = getRandomHex(16);
  assert.match(value, /^[0-9a-f]{32}$/);
});

test('getRandomHex falls back to Math.random when crypto.getRandomValues is unavailable', () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: originalCrypto?.randomUUID },
    configurable: true
  });

  try {
    const value = getRandomHex(8);
    assert.match(value, /^[0-9a-f]{16}$/);
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

test('getStringSizeInBytes uses UTF-8 byte size', () => {
  assert.equal(getStringSizeInBytes('abc'), 3);
  assert.equal(getStringSizeInBytes('😀'), 4);
});
