import test from 'node:test';
import assert from 'node:assert/strict';

import { createPendingRequestsStore } from '../src/internal/pendingRequests.js';

test('clear on unknown id is a no-op', () => {
  const pendingRequests = createPendingRequestsStore();
  assert.doesNotThrow(() => pendingRequests.clear('missing-id'));
  assert.equal(pendingRequests.size(), 0);
});
