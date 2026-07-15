export class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  async createPaymentLink() { throw new Error(`${this.name} does not implement createPaymentLink().`); }
  verifyWebhook() { throw new Error(`${this.name} does not implement verifyWebhook().`); }
  async getPaymentStatus() { throw new Error(`${this.name} does not implement getPaymentStatus().`); }
  async refundPayment() { throw new Error(`${this.name} does not implement refundPayment().`); }
}
