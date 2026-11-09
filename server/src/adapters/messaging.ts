import { config } from '../config.js';

export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Development SMS: prints to the server console (and keeps the last few for tests). */
export const sentSms: { to: string; message: string }[] = [];

class ConsoleSms implements SmsSender {
  async send(to: string, message: string) {
    sentSms.push({ to, message });
    if (sentSms.length > 100) sentSms.shift();
    if (config.env !== 'test') console.log(`[sms -> ${to}] ${message}`);
  }
}

/** Termii (Nigerian SMS provider). Set SMS_PROVIDER=termii and TERMII_API_KEY to enable. */
class TermiiSms implements SmsSender {
  async send(to: string, message: string) {
    const res = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: to.replace('+', ''),
        from: config.sms.termiiSenderId,
        sms: message,
        type: 'plain',
        channel: 'generic',
        api_key: config.sms.termiiApiKey,
      }),
    });
    if (!res.ok) throw new Error(`Termii SMS failed: ${res.status} ${await res.text()}`);
  }
}

class ConsoleEmail implements EmailSender {
  async send(to: string, subject: string, body: string) {
    if (config.env !== 'test') console.log(`[email -> ${to}] ${subject}\n${body}`);
  }
}

export const sms: SmsSender = config.sms.provider === 'termii' ? new TermiiSms() : new ConsoleSms();
export const email: EmailSender = new ConsoleEmail();
