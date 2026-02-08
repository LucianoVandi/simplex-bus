import { CommandBusDisposedError } from '../errors.js';

export const createDisposalController = () => {
  let disposed = false;

  const assertNotDisposed = () => {
    if (disposed) {
      throw new CommandBusDisposedError('Bus is disposed.');
    }
  };

  return {
    isDisposed: () => disposed,
    assertNotDisposed,
    dispose: (cleanup) => {
      if (disposed) {
        return false;
      }

      disposed = true;
      cleanup();
      return true;
    }
  };
};
