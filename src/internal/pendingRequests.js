export const createPendingRequestsStore = () => {
  const pendingRequests = new Map();

  const clear = (id) => {
    const pending = pendingRequests.get(id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);

    if (pending.abortListener && pending.signal) {
      pending.signal.removeEventListener('abort', pending.abortListener);
    }

    pendingRequests.delete(id);
  };

  const rejectAll = (error) => {
    for (const [id, pending] of pendingRequests.entries()) {
      clear(id);
      pending.reject(error);
    }
  };

  return {
    get: (id) => pendingRequests.get(id),
    set: (id, pending) => pendingRequests.set(id, pending),
    size: () => pendingRequests.size,
    clear,
    rejectAll
  };
};
