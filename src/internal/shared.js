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

export class CsprngUnavailableError extends Error {
  constructor(message = 'CSPRNG is not available in this environment') {
    super(message);
    this.name = 'CsprngUnavailableError';
  }
}

const TEXT_ENCODER = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;

export const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const getStringSizeInBytes = (value) =>
  TEXT_ENCODER ? TEXT_ENCODER.encode(value).length : value.length;

const tryGetBrowserCsprng = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    return crypto.getRandomValues.bind(crypto);
  }
  return null;
};

export const getCsprng = ({ requireSecure = false, logger = null } = {}) => {
  const browserCsprng = tryGetBrowserCsprng();
  if (browserCsprng) {
    return browserCsprng;
  }

  if (requireSecure) {
    throw new CsprngUnavailableError();
  }

  const warnFn = logger?.warn?.bind(logger) ?? console.warn.bind(console);
  warnFn('[SimplexBus] CSPRNG unavailable, falling back to Math.random (cryptographically insecure)');

  return (buffer) => {
    for (let i = 0; i < buffer.length; i += 1) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  };
};

export const getRandomHex = (sizeInBytes) => {
  const bytes = new Uint8Array(sizeInBytes);
  const csprng = getCsprng({ requireSecure: false });
  csprng(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
};
