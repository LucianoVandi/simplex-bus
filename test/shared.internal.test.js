import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRandomHex,
  getStringSizeInBytes,
  getCsprng,
  CsprngUnavailableError
} from '../src/internal/shared.js';

test('getRandomHex returns expected hex length when crypto.getRandomValues is available', async () => {
  const value = getRandomHex(16);
  assert.match(value, /^[0-9a-f]{32}$/);
});

test('getRandomHex falls back to Math.random when crypto.getRandomValues is unavailable', () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;
  const originalWarn = console.warn;

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: originalCrypto?.randomUUID },
    configurable: true
  });
  console.warn = () => {};

  try {
    const value = getRandomHex(8);
    assert.match(value, /^[0-9a-f]{16}$/);
  } finally {
    console.warn = originalWarn;
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

test('getCsprng returns crypto.getRandomValues when available', () => {
  const csprng = getCsprng();
  assert.equal(typeof csprng, 'function');
});

test('getCsprng throws CsprngUnavailableError in strict mode when CSPRNG unavailable', () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: originalCrypto?.randomUUID },
    configurable: true
  });

  try {
    assert.throws(() => getCsprng({ requireSecure: true }), CsprngUnavailableError);
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

test('getCsprng returns fallback in permissive mode when CSPRNG unavailable', () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: originalCrypto?.randomUUID },
    configurable: true
  });

  try {
    const logger = { warn: () => {} };
    const csprng = getCsprng({ requireSecure: false, logger });
    assert.equal(typeof csprng, 'function');
    const bytes = new Uint8Array(8);
    csprng(bytes);
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

test('getCsprng emits warning via logger when falling back to Math.random', () => {
  const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const originalCrypto = globalThis.crypto;

  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: originalCrypto?.randomUUID },
    configurable: true
  });

  try {
    const warnings = [];
    const logger = { warn: (msg) => warnings.push(msg) };
    getCsprng({ requireSecure: false, logger });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Math\.random/);
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
