import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;

/**
 * Initialize email transport
 */
function getTransporter() {
  if (!transporter && config.email?.auth?.user && config.email?.auth?.pass) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: {
        user: config.email.auth.user,
        pass: config.email.auth.pass
      }
    });
  }
  return transporter;
}

/**
 * Send password reset email
 * @param {string} email - Recipient email address
 * @param {string} resetToken - JWT token for password reset
 * @returns {Promise<boolean>} - true if sent successfully
 */
export async function sendPasswordResetEmail(email, resetToken) {
  const transport = getTransporter();
  
  if (!transport) {
    console.warn('Email transport is not configured. Reset token:', resetToken);
    return false;
  }

  const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;
  
  const mailOptions = {
    from: config.email.from,
    to: email,
    subject: 'Password Reset - RPA',
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .button { 
              display: inline-block; 
              padding: 12px 24px; 
              background-color: #007bff; 
              color: #ffffff !important; 
              text-decoration: none; 
              border-radius: 4px; 
              margin: 20px 0; 
            }
            .button:hover {
              background-color: #0056b3;
              color: #ffffff !important;
            }
            .button:visited {
              color: #ffffff !important;
            }
            a.button {
              color: #ffffff !important;
            }
            .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Password Reset</h2>
            <p>Hello,</p>
            <p>You are receiving this email because you (or someone else) requested a password reset for your account in the RPA system.</p>
            <p>To complete the password reset, click the following button:</p>
            <a href="${resetUrl}" class="button">Reset Password</a>
            <p>Alternatively, you can use this link:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p><strong>This link will expire in 1 hour.</strong></p>
            <p>If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>
            <div class="footer">
              <p>This is an automated message, please do not reply.</p>
              <p>RPA - Retail Prices Analyzer</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Password Reset

Hello,

You are receiving this email because you (or someone else) requested a password reset for your account in the RPA Backend system.

To complete the password reset, open the following link in your browser:
${resetUrl}

This link will expire in 1 hour.

If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.

---
This is an automated message, please do not reply.
RPA Backend - Retail Prices Analyzer
    `
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log('Reset email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
}

/**
 * Verify email configuration
 * @returns {Promise<boolean>}
 */
export async function verifyEmailConfig() {
  const transport = getTransporter();
  
  if (!transport) {
    return false;
  }

  try {
    await transport.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration is not valid:', error.message);
    return false;
  }
}
