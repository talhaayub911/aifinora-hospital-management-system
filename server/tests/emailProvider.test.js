import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { createApp } from '../src/app.js';
import { DisabledEmailProvider } from '../src/services/email/DisabledEmailProvider.js';
import { LocalSimulationEmailProvider } from '../src/services/email/LocalSimulationEmailProvider.js';
import { createEmailProvider, sendEmailAfterCommit } from '../src/services/email/email.service.js';

const exampleMessage = {
  to: ['administrator@example.invalid'],
  subject: 'Subscription reminder',
  text: 'A fictional invoice is due soon.',
  metadata: { notificationId: 'notification-example' },
};

describe('email provider boundary', () => {
  test('local simulation is explicit and never claims delivery', async () => {
    const result = await sendEmailAfterCommit(exampleMessage, new LocalSimulationEmailProvider());

    expect(result).toMatchObject({
      provider: 'LOCAL_SIMULATION',
      outcome: 'SIMULATED',
      delivered: false,
      simulated: true,
      recipientCount: 1,
    });
    expect(result.simulationId).toMatch(/^email-simulation-[a-f0-9]{24}$/);
    expect(result).not.toHaveProperty('to');
    expect(result).not.toHaveProperty('text');
  });

  test('disabled provider validates the request but performs no delivery', async () => {
    const result = await sendEmailAfterCommit(exampleMessage, new DisabledEmailProvider());

    expect(result).toEqual({
      provider: 'DISABLED',
      outcome: 'SKIPPED',
      delivered: false,
      simulated: false,
      message: 'Email delivery is disabled; no message was sent.',
    });
    await expect(sendEmailAfterCommit({ subject: 'Missing recipient', text: 'No destination.' }, new DisabledEmailProvider()))
      .rejects.toThrow('valid recipient');
  });

  test('unsupported provider configuration fails closed', () => {
    expect(() => createEmailProvider('smtp')).toThrow('Unsupported EMAIL_PROVIDER');
  });

  test('health reports the selected email mode without claiming real delivery', async () => {
    const response = await request(createApp({ prismaClient: {} })).get('/api/health').expect(200);

    expect(response.body.data.notifications.inApp).toEqual({ enabled: true });
    expect(response.body.data.notifications.email).toMatchObject({
      channel: 'email',
      provider: 'LOCAL_SIMULATION',
      mode: 'simulation',
      realDeliveryConfigured: false,
      deliveryEnabled: false,
      simulationEnabled: true,
    });
  });
});
