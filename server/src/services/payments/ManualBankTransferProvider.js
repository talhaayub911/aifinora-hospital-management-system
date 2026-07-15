import { PaymentProvider } from './PaymentProvider.js';

export class ManualBankTransferProvider extends PaymentProvider {
  constructor() { super('MANUAL_BANK_TRANSFER'); }

  async createPaymentLink() {
    return { provider: this.name, supported: false, message: 'Manual bank transfers use the payment-proof submission workflow.' };
  }

  verifyWebhook() { return false; }
  async getPaymentStatus() { return { status: 'MANUAL_REVIEW_REQUIRED' }; }
  async refundPayment() { return { supported: false, message: 'Manual refunds require Super Admin review.' }; }
}
