import {
  createCommandBus,
  createSchemaValidators
} from '../../../index.js';

const bus = createCommandBus({
  sendFn: () => {}
});

void bus.request('ping', undefined, '1000');

bus.send(123, {});

createSchemaValidators({
  schemaMap: {
    ping: {
      request: { type: 'object' }
    }
  },
  compile: () => 1
});
