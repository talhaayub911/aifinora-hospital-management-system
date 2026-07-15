import { createHash } from 'node:crypto';
import { EmailProvider, validateEmailMessage } from './EmailProvider.js';

export class LocalSimulationEmailProvider extends EmailProvider {
  constructor() {
    super('LOCAL_SIMULATION');
  }

  getStatus() {
    return {
      channel: 'email',
      provider: this.name,
      mode: 'simulation',
      realDeliveryConfigured: false,
      deliveryEnabled: false,
      simulationEnabled: true,
      message: 'Email is simulated in-process. No message leaves the application.',
    };
  }

  async sendAfterCommit(message) {
    const normalized = validateEmailMessage(message);
    const simulationId = createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .slice(0, 24);

    return {
      provider: this.name,
      outcome: 'SIMULATED',
      delivered: false,
      simulated: true,
      simulationId: `email-simulation-${simulationId}`,
      recipientCount: normalized.to.length,
      message: 'Email was simulated only; no message was delivered.',
    };
  }
}
