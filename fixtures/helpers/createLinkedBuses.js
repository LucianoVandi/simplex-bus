import { createCommandBus } from '../../index.js';

export function createLinkedBuses(configA = {}, configB = {}) {
  let busA;
  let busB;

  busA = createCommandBus({
    ...configA,
    sendFn: (message) => busB.receive(message)
  });

  busB = createCommandBus({
    ...configB,
    sendFn: (message) => busA.receive(message)
  });

  return { busA, busB };
}
