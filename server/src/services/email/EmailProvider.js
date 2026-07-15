export class EmailProvider {
  constructor(name) {
    if (!name) throw new Error('An email provider name is required.');
    this.name = name;
  }

  getStatus() {
    throw new Error(`${this.name} does not implement getStatus().`);
  }

  async sendAfterCommit(_message) {
    throw new Error(`${this.name} does not implement sendAfterCommit().`);
  }
}

export function validateEmailMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new TypeError('Email message must be an object.');
  }

  const recipients = Array.isArray(message.to) ? message.to : [message.to];
  const normalizedRecipients = recipients.map((recipient) => String(recipient || '').trim()).filter(Boolean);
  if (!normalizedRecipients.length || normalizedRecipients.some((recipient) => !recipient.includes('@'))) {
    throw new TypeError('Email message requires at least one valid recipient.');
  }

  const subject = String(message.subject || '').trim();
  if (!subject) throw new TypeError('Email message requires a subject.');
  if (!message.text && !message.html) throw new TypeError('Email message requires text or HTML content.');

  return {
    to: normalizedRecipients,
    subject,
    text: message.text ? String(message.text) : null,
    html: message.html ? String(message.html) : null,
    metadata: message.metadata && typeof message.metadata === 'object' ? message.metadata : {},
  };
}
