import crypto from 'node:crypto';
import { config } from '../config.js';

export interface InitializeInput {
  reference: string;
  amountNaira: number;
  email: string;
  callbackUrl: string;
  subaccount?: string | null;
  /** Method the customer picked in the app; the hosted checkout opens on it. */
  channel?: PaymentChannel;
  metadata?: Record<string, unknown>;
}

export const PAYMENT_CHANNELS = ['card', 'bank_transfer', 'ussd'] as const;
export type PaymentChannel = (typeof PAYMENT_CHANNELS)[number];

export interface VerifiedTransaction {
  reference: string;
  status: 'success' | 'failed' | 'pending';
  amountNaira: number;
  method: string | null;
  paidAt: string | null;
}

export interface PaymentGateway {
  name: string;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string }>;
  verify(reference: string): Promise<VerifiedTransaction>;
  refund(reference: string, amountNaira: number): Promise<{ refundReference: string }>;
  /** Checks the webhook signature over the raw request body. */
  verifySignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Payout setup for facilities (registration step "Where we send your payments"). */
  listBanks(): Promise<Bank[]>;
  resolveAccount(bankCode: string, accountNumber: string, hint?: string): Promise<{ accountName: string }>;
  createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }): Promise<{ code: string }>;
}

export interface Bank {
  code: string;
  name: string;
}

const MOCK_BANKS: Bank[] = [
  ['044', 'Access Bank'], ['023', 'Citibank Nigeria'], ['050', 'Ecobank Nigeria'], ['070', 'Fidelity Bank'],
  ['011', 'First Bank of Nigeria'], ['214', 'First City Monument Bank'], ['058', 'Guaranty Trust Bank'],
  ['082', 'Keystone Bank'], ['50211', 'Kuda Bank'], ['50515', 'Moniepoint MFB'], ['999992', 'OPay'],
  ['999991', 'PalmPay'], ['076', 'Polaris Bank'], ['221', 'Stanbic IBTC Bank'], ['232', 'Sterling Bank'],
  ['032', 'Union Bank of Nigeria'], ['033', 'United Bank for Africa'], ['035', 'Wema Bank'], ['057', 'Zenith Bank'],
].map(([code, name]) => ({ code, name }));

function hmacSha512(secret: string, body: Buffer): string {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * Test-mode gateway. Checkout happens on the web app's /mock-checkout page, which asks the API
 * to fire a Paystack-shaped, HMAC-signed webhook, so the real webhook path is exercised.
 */
export class MockGateway implements PaymentGateway {
  name = 'mock';
  readonly transactions = new Map<string, VerifiedTransaction>();

  async initialize(input: InitializeInput) {
    this.transactions.set(input.reference, {
      reference: input.reference,
      status: 'pending',
      amountNaira: input.amountNaira,
      method: null,
      paidAt: null,
    });
    const method = input.channel ? `?method=${input.channel}` : '';
    return { authorizationUrl: `${config.webUrl}/mock-checkout/${encodeURIComponent(input.reference)}${method}` };
  }

  async verify(reference: string) {
    return (
      this.transactions.get(reference) ?? { reference, status: 'failed' as const, amountNaira: 0, method: null, paidAt: null }
    );
  }

  async refund(reference: string) {
    return { refundReference: `RF-${reference}` };
  }

  /** Records a simulated customer payment and returns the signed webhook to deliver. */
  complete(reference: string, method: string, success: boolean) {
    const tx = this.transactions.get(reference);
    if (!tx) return null;
    tx.status = success ? 'success' : 'failed';
    tx.method = method;
    tx.paidAt = success ? new Date().toISOString() : null;
    const body = Buffer.from(
      JSON.stringify({
        event: success ? 'charge.success' : 'charge.failed',
        data: { reference, amount: Math.round(tx.amountNaira * 100), channel: method, paid_at: tx.paidAt },
      }),
    );
    return { body, signature: hmacSha512(config.payments.secretKey, body) };
  }

  verifySignature(rawBody: Buffer, signature: string | undefined) {
    return !!signature && safeEqual(hmacSha512(config.payments.secretKey, rawBody), signature);
  }

  async listBanks() {
    return MOCK_BANKS;
  }

  /** Test mode: any 10-digit number resolves, to the business name given as a hint. */
  async resolveAccount(bankCode: string, accountNumber: string, hint?: string) {
    if (!/^\d{10}$/.test(accountNumber) || !MOCK_BANKS.some((b) => b.code === bankCode)) {
      throw new Error('Account not found');
    }
    return { accountName: (hint || 'MedAssist Test Account').toUpperCase() };
  }

  async createSubaccount() {
    return { code: `ACCT_test${crypto.randomBytes(5).toString('hex')}` };
  }
}

/** Paystack (card, bank transfer, USSD). Set PAYMENT_PROVIDER=paystack and PAYSTACK_SECRET_KEY (sk_test_...). */
export class PaystackGateway implements PaymentGateway {
  name = 'paystack';
  private base = 'https://api.paystack.co';

  private async call(path: string, init: RequestInit = {}) {
    const res = await fetch(this.base + path, {
      ...init,
      headers: { Authorization: `Bearer ${config.payments.secretKey}`, 'Content-Type': 'application/json' },
    });
    const json = (await res.json()) as { status: boolean; message: string; data: any };
    if (!res.ok || !json.status) throw new Error(`Paystack ${path}: ${json.message}`);
    return json.data;
  }

  async initialize(input: InitializeInput) {
    const data = await this.call('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: input.email,
        amount: Math.round(input.amountNaira * 100),
        reference: input.reference,
        callback_url: input.callbackUrl,
        channels: input.channel ? [input.channel] : [...PAYMENT_CHANNELS],
        subaccount: input.subaccount ?? undefined,
        metadata: input.metadata,
      }),
    });
    return { authorizationUrl: data.authorization_url as string };
  }

  async verify(reference: string): Promise<VerifiedTransaction> {
    const data = await this.call(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      reference,
      status: data.status === 'success' ? 'success' : data.status === 'failed' ? 'failed' : 'pending',
      amountNaira: data.amount / 100,
      method: data.channel ?? null,
      paidAt: data.paid_at ?? null,
    };
  }

  async refund(reference: string, amountNaira: number) {
    const data = await this.call('/refund', {
      method: 'POST',
      body: JSON.stringify({ transaction: reference, amount: Math.round(amountNaira * 100) }),
    });
    return { refundReference: String(data.id ?? data.transaction?.reference ?? reference) };
  }

  verifySignature(rawBody: Buffer, signature: string | undefined) {
    return !!signature && safeEqual(hmacSha512(config.payments.secretKey, rawBody), signature);
  }

  async listBanks() {
    const data = await this.call('/bank?country=nigeria&perPage=100');
    return (data as { code: string; name: string }[]).map((b) => ({ code: b.code, name: b.name }));
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const data = await this.call(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`);
    return { accountName: data.account_name as string };
  }

  async createSubaccount(input: { businessName: string; bankCode: string; accountNumber: string }) {
    const data = await this.call('/subaccount', {
      method: 'POST',
      body: JSON.stringify({
        business_name: input.businessName,
        settlement_bank: input.bankCode,
        account_number: input.accountNumber,
        percentage_charge: config.payments.platformFeePercent,
      }),
    });
    return { code: data.subaccount_code as string };
  }
}

export const gateway: PaymentGateway = config.payments.provider === 'paystack' ? new PaystackGateway() : new MockGateway();
