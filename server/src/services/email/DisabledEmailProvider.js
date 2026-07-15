import { EmailProvider, validateEmailMessage } from './EmailProvider.js';

export class DisabledEmailProvider extends EmailProvider {
  constructor() {
    super('DISABLED');
  }

  getStatus() {
    return {
      channel: 'email',
      provider: this.name,
      mode: 'disabled',
      realDeliveryConfigured: false,
      deliveryEnabled: false,
      simulationEnabled: false,
      message: 'Email delivery is disabled. In-app notifications remain available.',
    };
  }

  async sendAfterCommit(message) {
    validateEmailMessage(message);
    return {
      provider: this.name,
      outcome: 'SKIPPED',
      delivered: false,
      simulated: false,
      message: 'Email delivery is disabled; no message was sent.',
    };
  }
}
