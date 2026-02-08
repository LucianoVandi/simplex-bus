import {
  CommandBusAbortedError,
  CommandBusLimitError,
  CommandBusTimeoutError
} from '../errors.js';
import { parseRequestOptions } from './config.js';
import { getRandomHex, isNonEmptyString } from './shared.js';

export const createRequest = ({
  assertNotDisposed,
  pendingRequests,
  maxPendingRequests,
  getResponseType,
  generateId,
  sendEnvelope
}) => (type, payload, optionsOrTimeout) => {
  assertNotDisposed();

  if (!isNonEmptyString(type)) {
    throw new TypeError('`type` must be a non-empty string.');
  }

  const { timeout, signal } = parseRequestOptions(optionsOrTimeout);

  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new TypeError('`timeout` must be a finite number greater than or equal to 0.');
  }

  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('`signal` must be an instance of AbortSignal when provided.');
  }

  const id = generateId();
  const nonce = getRandomHex(16);
  const expectedResponseType = getResponseType(type);

  if (pendingRequests.size() >= maxPendingRequests) {
    throw new CommandBusLimitError(
      `Pending request limit reached (${maxPendingRequests}). Resolve or abort requests before creating new ones.`
    );
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.clear(id);
      reject(new CommandBusTimeoutError(type, timeout));
    }, timeout);

    const pending = {
      type,
      expectedResponseType,
      nonce,
      timer,
      signal,
      abortListener: undefined,
      resolve,
      reject
    };

    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new CommandBusAbortedError(type));
        return;
      }

      pending.abortListener = () => {
        pendingRequests.clear(id);
        reject(new CommandBusAbortedError(type));
      };

      signal.addEventListener('abort', pending.abortListener, { once: true });
    }

    pendingRequests.set(id, pending);

    try {
      sendEnvelope({ type, payload, id, nonce });
    } catch (error) {
      pendingRequests.clear(id);
      reject(error);
    }
  });
};
