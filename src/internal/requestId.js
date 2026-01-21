import { getRandomHex } from './shared.js';

export const createRequestIdGenerator = () => {
  let counter = 0;

  return () => {
    counter += 1;

    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `cmd-${crypto.randomUUID()}`;
    }

    return `cmd-${getRandomHex(16)}-${counter}`;
  };
};
