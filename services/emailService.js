const nodemailer = require('nodemailer');
const { MailtrapTransport } = require('mailtrap');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.websiteUrl = process.env.CLIENT_URL || 'https://belucky.win';
    
    // Remove trailing slash if exists
    this.websiteUrl = this.websiteUrl.replace(/\/$/, '');
    
    // Use Cloudinary logo URL from environment variable, fallback to Imgur
    this.logoUrl = process.env.LOGO_URL || 'https://i.imgur.com/XCWdVBK.png';
    console.log('✅ Using logo from:', this.logoUrl);
  }

  init() {
    if (this.initialized) return;

    console.log('🔧 Initializing Mailtrap with API token...');
    
    this.transporter = nodemailer.createTransport(
      MailtrapTransport({
        token: process.env.MAILTRAP_API_TOKEN,
      })
    );

    this.initialized = true;

    // Verify email service
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email service configuration error:', error);
      } else {
        console.log('✅ Email service is ready to send emails');
      }
    });
  }

  // Get sender info
  getSender() {
    return {
      address: process.env.SMTP_FROM_EMAIL || 'noreply@belucky.win',
      name: process.env.SMTP_FROM_NAME || 'Belucky'
    };
  }

  // Send OTP email
  async sendOTP(email, otp, purpose = 'registration') {
    this.init();

    const config = {
      registration: {
        subject: 'Verify Your Belucky Account',
        title: 'Email Verification',
        message: 'Enter this code to verify your account and claim your welcome bonus.'
      },
      password_reset: {
        subject: 'Reset Your Password',
        title: 'Password Reset',
        message: 'Enter this code to reset your password.'
      },
      email_verification: {
        subject: 'Verify Your Email',
        title: 'Email Verification',
        message: 'Enter this code to verify your email address.'
      },
      withdrawal: {
        subject: 'Confirm Your Withdrawal',
        title: 'Withdrawal Verification',
        message: 'Enter this code to confirm your withdrawal request.'
      }
    };

    const { subject, title, message } = config[purpose];

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
.wrapper { background: #f5f5f5; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.header { background: #ffffff; padding: 20px 30px 10px 30px; text-align: center; }
.content { padding: 20px 30px 40px 30px; background: #ffffff; }
.title { margin: 0 0 15px 0; color: #111827; font-size: 28px; font-weight: 700; text-align: center; }
.message { margin: 0 0 30px 0; color: #6b7280; font-size: 15px; text-align: center; line-height: 1.6; }
.otp-box { background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border: 2px solid #a855f7; border-radius: 16px; padding: 30px 20px; margin: 0 auto 30px; max-width: 400px; text-align: center; }
.otp-label { margin: 0 0 10px 0; color: #7c3aed; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; }
.otp-code { margin: 0; font-size: 42px; font-weight: bold; color: #7c3aed; letter-spacing: 10px; font-family: 'Courier New', monospace; }
.otp-validity { margin: 10px 0 0 0; color: #7c3aed; font-size: 13px; font-weight: 500; }
.warning-box { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; border-radius: 8px; margin: 0 auto; max-width: 500px; }
.warning-text { margin: 0; color: #92400e; font-size: 13px; line-height: 1.6; }
.footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
.footer-text { margin: 0 0 15px 0; color: #6b7280; font-size: 14px; }
.footer-link { display: inline-block; color: #1877f2; text-decoration: none; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
.footer-link:hover { text-decoration: underline; }
.footer-copy { margin: 0; color: #9ca3af; font-size: 12px; }
@media only screen and (max-width: 600px) {
  .wrapper { padding: 20px 10px; }
  .container { border-radius: 10px; }
  .header { padding: 15px 20px 10px 20px; }
  .content { padding: 20px 15px 30px 15px; }
  .otp-code { font-size: 32px; letter-spacing: 6px; }
  .title { font-size: 22px; }
  .message { font-size: 14px; }
  .otp-box { padding: 20px 15px; }
  .warning-box { padding: 12px 15px; }
  .footer { padding: 20px 15px; }
}
</style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="${this.logoUrl}" alt="Belucky" width="140" style="max-width: 140px; height: auto;">
    </div>
    <div class="content">
      <h2 class="title">${title}</h2>
      <p class="message">${message}</p>
      <div class="otp-box">
        <p class="otp-label">Verification Code</p>
        <div class="otp-code">${otp}</div>
        <p class="otp-validity">Valid for 10 minutes</p>
      </div>
      <div class="warning-box">
        <p class="warning-text"><strong>Security Notice:</strong> Never share this code with anyone. Belucky will never ask for your verification code.</p>
      </div>
    </div>
    <div class="footer">
      <p class="footer-text">Need help? Contact us on Facebook</p>
      <a href="https://www.facebook.com/belucky.win" class="footer-link">Visit Belucky Win on Facebook</a>
      <p class="footer-copy" style="margin-top: 20px;">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
    </div>
  </div>
</div>
</body>
</html>
    `;

    const sender = this.getSender();

    const mailOptions = {
      from: sender,
      to: email,
      subject: subject,
      html: htmlContent,
      text: `Your ${purpose} verification code is: ${otp}. Valid for 10 minutes. Never share this code. - Belucky.win`,
      category: 'OTP Verification'
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('✅ OTP email sent successfully:', info.messageId || info.response || 'Email sent');
      return { success: true, messageId: info.messageId || info.response };
    } catch (error) {
      console.error('❌ Error sending OTP email:', error);
      throw error;
    }
  }

  // Send welcome email
  async sendWelcomeEmail(email, username) {
    this.init();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
.wrapper { background: #f5f5f5; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.header { background: #ffffff; padding: 20px 30px 10px 30px; text-align: center; }
.content { padding: 20px 30px 40px 30px; background: #ffffff; }
.title { margin: 0 0 15px 0; color: #111827; font-size: 30px; font-weight: 700; text-align: center; }
.message { margin: 0 0 30px 0; color: #6b7280; font-size: 16px; text-align: center; line-height: 1.6; }
.bonus-card { background: linear-gradient(135deg, #f3e8ff 0%, #e9d5ff 100%); border: 2px solid #a855f7; border-radius: 16px; padding: 35px 25px; margin: 0 auto 30px; max-width: 400px; text-align: center; }
.bonus-label { margin: 0 0 10px 0; color: #7c3aed; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; }
.bonus-amount { margin: 0; color: #7c3aed; font-size: 44px; font-weight: bold; }
.bonus-text { margin: 10px 0 0 0; color: #7c3aed; font-size: 14px; font-weight: 500; }
.cta-button { display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; margin-bottom: 20px; }
.sub-message { margin: 0; color: #9ca3af; font-size: 13px; text-align: center; }
.footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
.footer-text { margin: 0 0 15px 0; color: #6b7280; font-size: 14px; }
.footer-link { display: inline-block; color: #1877f2; text-decoration: none; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
.footer-link:hover { text-decoration: underline; }
.footer-copy { margin: 0; color: #9ca3af; font-size: 12px; }
@media only screen and (max-width: 600px) {
  .wrapper { padding: 20px 10px; }
  .container { border-radius: 10px; }
  .header { padding: 15px 20px 10px 20px; }
  .content { padding: 20px 15px 30px 15px; }
  .title { font-size: 24px; }
  .message { font-size: 14px; }
  .bonus-amount { font-size: 36px; }
  .bonus-card { padding: 25px 20px; }
  .cta-button { padding: 14px 32px; font-size: 15px; }
  .footer { padding: 20px 15px; }
}
</style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="${this.logoUrl}" alt="Belucky" width="140" style="max-width: 140px; height: auto;">
    </div>
    <div class="content">
      <h2 class="title">Welcome to Belucky!</h2>
      <p class="message">Hi <strong style="color: #111827;">${username}</strong>, your account is ready.<br>Let's get started!</p>
      <div class="bonus-card">
        <p class="bonus-label">Welcome Bonus</p>
        <div class="bonus-amount">$3.00</div>
        <p class="bonus-text">Added to your account</p>
      </div>
      <div style="text-align: center;">
        <a href="${this.websiteUrl}" class="cta-button">Start Playing Now</a>
      </div>
      <p class="sub-message">Explore our games, make your first deposit,<br>and enjoy exclusive rewards.</p>
    </div>
    <div class="footer">
      <p class="footer-text">Need help? Contact us on Facebook</p>
      <a href="https://www.facebook.com/belucky.win" class="footer-link">Visit Belucky Win on Facebook</a>
      <p class="footer-copy" style="margin-top: 20px;">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
    </div>
  </div>
</div>
</body>
</html>
    `;

    const sender = this.getSender();

    const mailOptions = {
      from: sender,
      to: email,
      subject: 'Welcome to Belucky - Your $3 Bonus Awaits',
      html: htmlContent,
      category: 'Welcome Email'
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('✅ Welcome email sent successfully to:', email);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending welcome email:', error);
      return { success: false, error: error.message };
    }
  }

  // Send password reset email
  async sendPasswordResetEmail(email, resetLink) {
    this.init();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
.wrapper { background: #f5f5f5; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.header { background: #ffffff; padding: 20px 30px 10px 30px; text-align: center; }
.content { padding: 20px 30px 40px 30px; background: #ffffff; text-align: center; }
.title { margin: 0 0 15px 0; color: #111827; font-size: 28px; font-weight: 700; }
.message { margin: 0 0 35px 0; color: #6b7280; font-size: 15px; line-height: 1.6; }
.reset-button { display: inline-block; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; margin-bottom: 20px; }
.sub-message { margin: 0; color: #9ca3af; font-size: 13px; }
.footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
.footer-text { margin: 0 0 15px 0; color: #6b7280; font-size: 14px; }
.footer-link { display: inline-block; color: #1877f2; text-decoration: none; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
.footer-link:hover { text-decoration: underline; }
.footer-copy { margin: 0; color: #9ca3af; font-size: 12px; }
@media only screen and (max-width: 600px) {
  .wrapper { padding: 20px 10px; }
  .container { border-radius: 10px; }
  .header { padding: 15px 20px 10px 20px; }
  .content { padding: 20px 15px 30px 15px; }
  .title { font-size: 22px; }
  .message { font-size: 14px; }
  .reset-button { padding: 14px 32px; font-size: 15px; }
  .footer { padding: 20px 15px; }
}
</style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="${this.logoUrl}" alt="Belucky" width="140" style="max-width: 140px; height: auto;">
    </div>
    <div class="content">
      <h2 class="title">Reset Your Password</h2>
      <p class="message">Click the button below to reset your password.<br>This link expires in 1 hour.</p>
      <a href="${resetLink}" class="reset-button">Reset Password</a>
      <p class="sub-message">If you didn't request this, please ignore this email<br>or contact support if you have concerns.</p>
    </div>
    <div class="footer">
      <p class="footer-text">Need help? Contact us on Facebook</p>
      <a href="https://www.facebook.com/belucky.win" class="footer-link">Visit Belucky Win on Facebook</a>
      <p class="footer-copy" style="margin-top: 20px;">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
    </div>
  </div>
</div>
</body>
</html>
    `;

    const sender = this.getSender();

    const mailOptions = {
      from: sender,
      to: email,
      subject: 'Reset Your Belucky Password',
      html: htmlContent,
      category: 'Password Reset'
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('✅ Password reset email sent successfully to:', email);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending password reset email:', error);
      throw error;
    }
  }

  // Send promotional/marketing email
  async sendPromotionalEmail(email, subject, title, message, buttonText, buttonLink) {
    this.init();

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; background: #f5f5f5; }
.wrapper { background: #f5f5f5; padding: 40px 20px; }
.container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
.header { background: #ffffff; padding: 20px 30px 10px 30px; text-align: center; }
.content { padding: 20px 30px 40px 30px; background: #ffffff; text-align: center; }
.title { margin: 0 0 15px 0; color: #111827; font-size: 28px; font-weight: 700; }
.message { margin: 0 0 35px 0; color: #6b7280; font-size: 15px; line-height: 1.6; }
.promo-button { display: inline-block; background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px; }
.footer { background: #f9fafb; padding: 30px; text-align: center; border-top: 1px solid #e5e7eb; }
.footer-text { margin: 0 0 15px 0; color: #6b7280; font-size: 14px; }
.footer-link { display: inline-block; color: #1877f2; text-decoration: none; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
.footer-link:hover { text-decoration: underline; }
.footer-copy { margin: 0; color: #9ca3af; font-size: 12px; }
@media only screen and (max-width: 600px) {
  .wrapper { padding: 20px 10px; }
  .container { border-radius: 10px; }
  .header { padding: 15px 20px 10px 20px; }
  .content { padding: 20px 15px 30px 15px; }
  .title { font-size: 22px; }
  .message { font-size: 14px; }
  .promo-button { padding: 14px 32px; font-size: 15px; }
  .footer { padding: 20px 15px; }
}
</style>
</head>
<body>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="${this.logoUrl}" alt="Belucky" width="140" style="max-width: 140px; height: auto;">
    </div>
    <div class="content">
      <h2 class="title">${title}</h2>
      <p class="message">${message}</p>
      <a href="${buttonLink}" class="promo-button">${buttonText}</a>
    </div>
    <div class="footer">
      <p class="footer-text">Need help? Contact us on Facebook</p>
      <a href="https://www.facebook.com/belucky.win" class="footer-link">Visit Belucky Win on Facebook</a>
      <p class="footer-copy" style="margin-top: 20px;">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
    </div>
  </div>
</div>
</body>
</html>
    `;

    const sender = this.getSender();

    const mailOptions = {
      from: sender,
      to: email,
      subject: subject,
      html: htmlContent,
      category: 'Promotional'
    };

    try {
      await this.transporter.sendMail(mailOptions);
      console.log('✅ Promotional email sent successfully to:', email);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending promotional email:', error);
      throw error;
    }
  }
}

// Export singleton instance
module.exports = new EmailService();