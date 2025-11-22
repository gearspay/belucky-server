// Facebook icon as base64 (rounded logo)
const nodemailer = require('nodemailer');
const { MailtrapTransport } = require('mailtrap');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initialized = false;
    this.websiteUrl = process.env.CLIENT_URL || 'https://belucky.win';
    
    // Remove trailing slash if exists
    this.websiteUrl = this.websiteUrl.replace(/\/$/, '');
    
    // Facebook icon as base64 (small, optimized)
    this.facebookIcon = 'data:image/webp;base64,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';
    
    // Use base64 logo if provided, otherwise fallback to Imgur CDN
    if (process.env.LOGO_BASE64) {
      // Detect image format from base64 string
      const base64Data = process.env.LOGO_BASE64;
      let imageFormat = 'png'; // default
      
      // Check if it's already a complete data URL
      if (base64Data.startsWith('data:image/')) {
        this.logoUrl = base64Data;
        console.log('✅ Using base64 embedded logo for emails (pre-formatted)');
      } else {
        // Detect format from base64 signature
        if (base64Data.startsWith('UklGR')) {
          imageFormat = 'webp';
        } else if (base64Data.startsWith('/9j/')) {
          imageFormat = 'jpeg';
        } else if (base64Data.startsWith('iVBORw')) {
          imageFormat = 'png';
        }
        
        this.logoUrl = `data:image/${imageFormat};base64,${base64Data}`;
        console.log(`✅ Using base64 embedded logo for emails (${imageFormat} format)`);
      }
    } else {
      this.logoUrl = 'https://i.imgur.com/XCWdVBK.png';
      console.log('✅ Using Imgur CDN logo for emails');
    }
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" style="display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #6b7280; font-size: 14px;">
        <img src="${this.facebookIcon}" width="32" height="32" style="border-radius: 50%;" alt="Facebook" />
        <span style="color: #6b7280;">Belucky Win</span>
      </a>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" style="display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #6b7280; font-size: 14px;">
        <img src="${this.facebookIcon}" width="32" height="32" style="border-radius: 50%;" alt="Facebook" />
        <span style="color: #6b7280;">Belucky Win</span>
      </a>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" style="display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #6b7280; font-size: 14px;">
        <img src="${this.facebookIcon}" width="32" height="32" style="border-radius: 50%;" alt="Facebook" />
        <span style="color: #6b7280;">Belucky Win</span>
      </a>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" style="display: inline-flex; align-items: center; gap: 10px; text-decoration: none; color: #6b7280; font-size: 14px;">
        <img src="${this.facebookIcon}" width="32" height="32" style="border-radius: 50%;" alt="Facebook" />
        <span style="color: #6b7280;">Belucky Win</span>
      </a>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" class="footer-button">
        <img src="${this.facebookIcon}" width="16" height="16" style="vertical-align: middle; margin-right: 6px;" alt="Facebook" />
        Belucky Win
      </a>
      <p class="footer-copy">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" class="footer-button">
        <img src="${this.facebookIcon}" width="16" height="16" style="vertical-align: middle; margin-right: 6px;" alt="Facebook" />
        Belucky Win
      </a>
      <p class="footer-copy">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" class="footer-button">📘 Belucky Win</a>
      <p class="footer-copy">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
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
.footer-button { display: inline-block; background: #1877f2; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 15px; }
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
  .footer-button { padding: 10px 20px; font-size: 13px; }
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
      <a href="https://www.facebook.com/belucky.win" class="footer-button">📘 Belucky Win</a>
      <p class="footer-copy">© ${new Date().getFullYear()} Belucky.win - All rights reserved</p>
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