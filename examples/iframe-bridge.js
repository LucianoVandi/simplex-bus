import { createCommandBus } from '../index.js';

/**
 * Example bridge for iframe parent <-> child messaging.
 */
export function createIframeBus({ targetWindow, targetOrigin = '*' }) {
  return createCommandBus({
    sendFn: (message) => targetWindow.postMessage(message, targetOrigin),
    onReceive: (handler) => {
      const listener = (event) => handler(event.data);
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    },
    allowedTypes: ['ping'],
    validators: {
      ping: (payload) => payload && payload.value === 'ping',
      'ping-response': (payload) => payload && payload.value === 'pong'
    }
  });
}
