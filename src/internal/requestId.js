import { getRandomHex } from './shared.js';

export const createRequestIdGenerator = () => {
  return () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cmd-${crypto.randomUUID()}`;
    }

    return `cmd-${getRandomHex(16)}`;
  };
};
