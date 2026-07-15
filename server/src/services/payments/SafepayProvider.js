import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/errors.js';
import { PaymentProvider } from './PaymentProvider.js';

export class SafepayProvider extends PaymentProvider {
  constructor(configuration = {}) {
    super('SAFEPAY');
    this.configuration = configuration;
  }

  get configured() {
    return Boolean(env.safepayPublicKey && env.safepaySecretKey && (env.safepayCreateLinkUrl || env.safepayApiBaseUrl));
  }

  get webhookConfigured() {
    return Boolean(env.safepayWebhookSecret);
  }

  get webhookVerificationMode() {
    return env.safepayWebhookVerificationMode;
  }

  // This repository contains a deliberately provider-agnostic structural
  // adapter. It must remain fail-closed in production until the merchant's
  // exact Safepay checkout and signature contract has been implemented and
  // certified in this class.
  get productionAdapterVerified() {
    return false;
  }

  get demoAllowed() {
    return env.nodeEnv !== 'production' && Boolean(env.demoMode || env.safepayDemoMode || this.configuration.demoMode);
  }

  get realPaymentsEnabled() {
    return this.configured && this.webhookConfigured && (env.nodeEnv !== 'production' || this.productionAdapterVerified);
  }

  async createPaymentLink(invoice) {
    if (!this.configured) {
      if (this.demoAllowed) {
        return {
          provider: 'SAFEPAY',
          demo: true,
          url: `${env.appBaseUrl}/payment-status?provider=safepay-demo&reference=${encodeURIComponent(invoice.invoiceNumber)}`,
          message: 'Safepay Demo: no merchant credentials are configured; no real payment will be processed.',
        };
      }
      throw new ApiError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Safepay merchant credentials and endpoint are not configured.');
    }
    if (!this.webhookConfigured) {
      throw new ApiError(503, 'PAYMENT_PROVIDER_NOT_CONFIGURED', 'Safepay webhook verification is not configured, so checkout cannot be enabled safely.');
    }
    // This repository intentionally ships only a structural sandbox adapter.
    // Production must replace/verify this class against the merchant-specific
    // Safepay contract before hosted checkout can be enabled.
    if (env.nodeEnv === 'production' && !this.productionAdapterVerified) {
      throw new ApiError(503, 'SAFEPAY_VERIFICATION_ADAPTER_REQUIRED', 'Safepay checkout is disabled until a production-verified webhook signature adapter is configured.');
    }

    const endpoint = env.safepayCreateLinkUrl || `${env.safepayApiBaseUrl.replace(/\/$/, '')}/order/v1/init`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sfpy-merchant-secret': env.safepaySecretKey,
        'x-sfpy-merchant-public-key': env.safepayPublicKey,
      },
      body: JSON.stringify({
        amount: Number(invoice.total) - Number(invoice.paidAmount),
        currency: invoice.currency,
        reference: invoice.invoiceNumber,
        metadata: { invoiceId: invoice.id, hospitalId: invoice.hospitalId },
        redirectUrl: `${env.appBaseUrl}/payment-status?invoice=${encodeURIComponent(invoice.invoiceNumber)}`,
        webhookUrl: `${env.apiBaseUrl}/api/webhooks/safepay`,
      }),
    });
    if (!response.ok) throw new ApiError(502, 'SAFEPAY_LINK_FAILED', 'Safepay did not create a payment link.');
    const payload = await response.json();
    const url = payload.url || payload.checkout_url || payload.data?.url;
    const providerReference = payload.tracker || payload.data?.tracker || payload.data?.token || payload.token;
    if (!url) throw new ApiError(502, 'SAFEPAY_INVALID_RESPONSE', 'Safepay returned no hosted checkout URL.');
    if (!providerReference) throw new ApiError(502, 'SAFEPAY_INVALID_RESPONSE', 'Safepay returned no checkout tracker for webhook reconciliation.');
    return { provider: 'SAFEPAY', demo: false, url, providerReference: String(providerReference), verificationMode: this.webhookVerificationMode };
  }

  verifyWebhook(rawBody, signature) {
    if (!this.webhookConfigured || !signature || !rawBody) return false;
    if (env.nodeEnv === 'production' && !this.productionAdapterVerified) return false;
    const expected = createHmac('sha256', env.safepayWebhookSecret).update(rawBody).digest('hex');
    const supplied = String(signature).replace(/^sha256=/i, '').trim().toLowerCase();
    if (expected.length !== supplied.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
  }

  async getPaymentStatus(reference) {
    return { provider: 'SAFEPAY', reference, status: 'WEBHOOK_AUTHORITATIVE', message: 'Subscription activation is based on a verified webhook, not a browser redirect.' };
  }

  async refundPayment() {
    return { supported: false, message: 'Safepay refunds require a separately verified production integration.' };
  }
}
