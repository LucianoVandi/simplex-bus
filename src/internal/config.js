import {
  RESPONSE_TRUST_MODES,
  isNonEmptyString,
  isObject
} from './shared.js';

export const parseRequestOptions = (optionsOrTimeout) => {
  if (typeof optionsOrTimeout === 'number' || optionsOrTimeout === undefined) {
    return { timeout: optionsOrTimeout ?? 5000, signal: undefined };
  }

  if (!isObject(optionsOrTimeout)) {
    throw new TypeError('Request options must be a number or an object.');
  }

  const timeout = optionsOrTimeout.timeout ?? 5000;
  return {
    timeout,
    signal: optionsOrTimeout.signal
  };
};

export const validateCreateConfig = ({
  sendFn,
  onReceive,
  allowedTypes,
  validators,
  parser,
  serializer,
  responseSuffix,
  maxIncomingMessageBytes,
  maxPendingRequests,
  responseTrustMode,
  isTrustedResponse
}) => {
  if (typeof sendFn !== 'function') {
    throw new TypeError('`sendFn` must be a function.');
  }

  if (onReceive !== undefined && typeof onReceive !== 'function') {
    throw new TypeError('`onReceive` must be a function when provided.');
  }

  if (!Array.isArray(allowedTypes)) {
    throw new TypeError('`allowedTypes` must be an array of strings.');
  }

  if (!isObject(validators)) {
    throw new TypeError('`validators` must be an object of functions.');
  }

  if (typeof parser !== 'function') {
    throw new TypeError('`parser` must be a function.');
  }

  if (typeof serializer !== 'function') {
    throw new TypeError('`serializer` must be a function.');
  }

  if (!isNonEmptyString(responseSuffix)) {
    throw new TypeError('`responseSuffix` must be a non-empty string.');
  }

  if (!Number.isFinite(maxIncomingMessageBytes) || maxIncomingMessageBytes <= 0) {
    throw new TypeError('`maxIncomingMessageBytes` must be a finite number greater than 0.');
  }

  if (!Number.isInteger(maxPendingRequests) || maxPendingRequests <= 0) {
    throw new TypeError('`maxPendingRequests` must be an integer greater than 0.');
  }

  if (!RESPONSE_TRUST_MODES.has(responseTrustMode)) {
    throw new TypeError('`responseTrustMode` must be one of: "auto", "strict", "permissive".');
  }

  if (typeof isTrustedResponse !== 'function') {
    throw new TypeError('`isTrustedResponse` must be a function when provided.');
  }
};
