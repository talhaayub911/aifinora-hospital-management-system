import { env } from '../../config/env.js';
import { DisabledEmailProvider } from './DisabledEmailProvider.js';
import { LocalSimulationEmailProvider } from './LocalSimulationEmailProvider.js';

const PROVIDER_FACTORIES = Object.freeze({
  disabled: () => new DisabledEmailProvider(),
  local_simulation: () => new LocalSimulationEmailProvider(),
});

export function createEmailProvider(providerName = env.emailProvider) {
  const normalizedName = String(providerName || '').trim().toLowerCase();
  const factory = PROVIDER_FACTORIES[normalizedName];
  if (!factory) {
    throw new Error(`Unsupported EMAIL_PROVIDER "${providerName}". Supported values: ${Object.keys(PROVIDER_FACTORIES).join(', ')}.`);
  }
  return factory();
}

export const emailProvider = createEmailProvider();

export function getEmailDeliveryStatus(provider = emailProvider) {
  return provider.getStatus();
}

// Workflows must call this only after their database transaction has resolved.
// A future network-backed provider belongs behind the same method so external
// delivery never holds locks or rolls back committed application data.
export async function sendEmailAfterCommit(message, provider = emailProvider) {
  return provider.sendAfterCommit(message);
}
