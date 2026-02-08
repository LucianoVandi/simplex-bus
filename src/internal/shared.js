export const NOOP_LOGGER = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
};

export const DEFAULT_RESPONSE_SUFFIX = '-response';
export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_MAX_INCOMING_MESSAGE_BYTES = 64 * 1024;
export const DEFAULT_MAX_PENDING_REQUESTS = 500;
export const DEFAULT_RESPONSE_TRUST_MODE = 'auto';
export const RESPONSE_TRUST_MODES = new Set(['auto', 'strict', 'permissive']);

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

export const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const getStringSizeInBytes = (value) =>
  TEXT_ENCODER ? TEXT_ENCODER.encode(value).length : value.length;

export const getRandomHex = (sizeInBytes) => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(sizeInBytes);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }

  let randomHex = '';
  for (let index = 0; index < sizeInBytes; index += 1) {
    randomHex += Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0');
  }

  return randomHex;
};
