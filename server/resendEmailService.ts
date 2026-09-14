/**
 * Resend Transactional Email Service
 * High-reliability email delivery with HTML templates, order receipts, and admin alerts
 * @license Apache-2.0
 */

export interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider: 'RESEND' | 'SIMULATION_FALLBACK';
}

export class ResendEmailService {
  private apiKey: string;
  private defaultFrom: string;

  constructor() {
    this.apiKey = process.env.RESEND_API_KEY || '';
    this.defaultFrom = process.env.EMAIL_FROM || 'Kisholoy Official <onboarding@resend.dev>';
  }

  /**
   * Check if Resend API key is configured
   */
  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.startsWith('re_'));
  }

  /**
   * Send an email via Resend REST API
   */
  public async sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
    const recipients = Array.isArray(params.to) ? params.to : [params.to];
    const cleanRecipients = recipients.filter(r => Boolean(r && r.includes('@')));

    if (cleanRecipients.length === 0) {
      return {
        success: false,
        error: 'No valid recipient email addresses provided',
        provider: 'RESEND',
      };
    }

    if (!this.isConfigured()) {
      console.log(`[Resend Email] (Simulated - No API Key) to ${cleanRecipients.join(', ')}: ${params.subject}`);
      return {
        success: true,
        messageId: `sim-email-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        provider: 'SIMULATION_FALLBACK',
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.defaultFrom,
          to: cleanRecipients,
          subject: params.subject,
          html: params.html,
          text: params.text,
          // No personal address in source: with nothing configured the header is
          // omitted and Resend handles replies from the From address.
          reply_to: params.replyTo || process.env.SYSTEM_ADMIN_EMAIL || undefined,
          tags: params.tags,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[Resend Email Error]', data);
        return {
          success: false,
          error: data.message || `HTTP ${response.status}: Failed to dispatch via Resend`,
          provider: 'RESEND',
        };
      }

      return {
        success: true,
        messageId: data.id,
        provider: 'RESEND',
      };
    } catch (err: any) {
      console.error('[Resend Email Exception]', err);
      return {
        success: false,
        error: err.message || 'Network error communicating with Resend',
        provider: 'RESEND',
      };
    }
  }

  /**
   * Render professional Bengali/English Order Confirmation Email HTML
   */
  public buildOrderEmailHtml(data: {
    orderNumber: string;
    customerName: string;
    items: Array<{ title: string; quantity: number; price: number }>;
    totalAmount: number;
    shippingAddress: string;
    trackingUrl?: string;
  }): string {
    const itemRows = data.items
      .map(
        item => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #e7e5e4; font-size: 14px; color: #1c1917;">${item.title}</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e7e5e4; font-size: 14px; text-align: center; color: #78716c;">×${item.quantity}</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #e7e5e4; font-size: 14px; text-align: right; font-weight: bold; color: #0c0a09;">৳${(item.price * item.quantity).toLocaleString()}</td>
        </tr>`
      )
      .join('');

    return `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>অর্ডার নিশ্চিতকরণ - কিশলয় (KISHOLOY)</title>
</head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #fafaf9; margin: 0; padding: 24px; color: #292524;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e7e5e4; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.03);">
    <tr>
      <td style="background-color: #134e4a; padding: 28px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: 0.5px;">কিশলয় • KISHOLOY</h1>
        <p style="color: #ccfbf1; margin: 6px 0 0 0; font-size: 13px;">অনলাইন কেনাকাটার বিশ্বস্ত প্রতিষ্ঠান</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 32px;">
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
          <h2 style="color: #166534; margin: 0; font-size: 16px; font-weight: 700;">ধন্যবাদ ${data.customerName}! আপনার অর্ডারটি সফলভাবে গৃহীত হয়েছে।</h2>
          <p style="color: #15803d; margin: 4px 0 0 0; font-size: 13px;">অর্ডার নম্বর: <strong>#${data.orderNumber}</strong></p>
        </div>

        <h3 style="font-size: 15px; color: #44403c; border-bottom: 2px solid #f5f5f4; padding-bottom: 8px; margin-top: 0;">অর্ডারের বিবরণ (Order Summary)</h3>
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 20px;">
          ${itemRows}
          <tr>
            <td colspan="2" style="padding: 14px 0 0 0; font-size: 15px; font-weight: 700; color: #1c1917;">সর্বমোট (Total):</td>
            <td style="padding: 14px 0 0 0; font-size: 18px; font-weight: 800; text-align: right; color: #134e4a;">৳${data.totalAmount.toLocaleString()}</td>
          </tr>
        </table>

        <div style="background-color: #f5f5f4; border-radius: 10px; padding: 14px; margin-bottom: 24px; font-size: 13px;">
          <strong style="color: #292524;">ডেলিভারি ঠিকানা:</strong><br/>
          <span style="color: #57534e;">${data.shippingAddress}</span>
        </div>

        ${data.trackingUrl ? `
        <div style="text-align: center; margin: 28px 0 16px 0;">
          <a href="${data.trackingUrl}" style="background-color: #134e4a; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 14px; font-weight: 700; display: inline-block;">অর্ডার লাইভ ট্র্যাক করুন</a>
        </div>
        ` : ''}

        <p style="font-size: 12px; color: #a8a29e; text-align: center; margin-top: 32px; border-top: 1px solid #f5f5f4; padding-top: 16px;">
          ${process.env.SYSTEM_ADMIN_EMAIL
            ? `যেকোনো প্রয়োজনে ইমেইল করুন: <a href="mailto:${process.env.SYSTEM_ADMIN_EMAIL}" style="color: #134e4a;">${process.env.SYSTEM_ADMIN_EMAIL}</a>`
            : 'যেকোনো প্রয়োজনে আমাদের ওয়েবসাইটের যোগাযোগ পেজ থেকে লিখুন।'}
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}

export const resendEmailService = new ResendEmailService();
