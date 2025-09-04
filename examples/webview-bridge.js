import { createCommandBus } from '../index.js';

/**
 * Example bridge for a WebView-like environment.
 * Replace `window.ReactNativeWebView.postMessage` with your transport.
 */
const bus = createCommandBus({
  sendFn: (message) => window.ReactNativeWebView.postMessage(message),
  onReceive: (handler) => {
    const listener = (event) => handler(event.data);
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  },
  allowedTypes: ['get-profile'],
  validators: {
    'get-profile': (payload) => payload === undefined,
    'get-profile-response': (payload) =>
      payload && typeof payload === 'object' && typeof payload.id === 'string'
  }
});

bus.on('get-profile', (_, context) => {
  context.respond({ id: 'u-42', name: 'Luciano' });
});

export async function fetchProfile() {
  return bus.request('get-profile', undefined, { timeout: 1500 });
}
