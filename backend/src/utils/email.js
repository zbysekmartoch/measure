import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transporter = null;

/**
 * Inicializace emailového transportu
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
 * Odeslání e-mailu pro reset hesla
 * @param {string} email - E-mail příjemce
 * @param {string} resetToken - JWT token pro reset
 * @returns {Promise<boolean>} - true pokud bylo odesláno úspěšně
 */
export async function sendPasswordResetEmail(email, resetToken) {
  const transport = getTransporter();
  
  if (!transport) {
    console.warn('Email transport není nakonfigurován. Reset token:', resetToken);
    return false;
  }

  const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;
  
  const mailOptions = {
    from: config.email.from,
    to: email,
    subject: 'Reset hesla - RPA',
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
            <h2>Reset hesla</h2>
            <p>Dobrý den,</p>
            <p>Obdrželi jste tento e-mail, protože jste (nebo někdo jiný) požádali o reset hesla pro váš účet v RPA systému.</p>
            <p>Pro dokončení resetu hesla klikněte na následující tlačítko:</p>
            <a href="${resetUrl}" class="button">Resetovat heslo</a>
            <p>Případně můžete použít tento odkaz:</p>
            <p><a href="${resetUrl}">${resetUrl}</a></p>
            <p><strong>Tento odkaz vyprší za 1 hodinu.</strong></p>
            <p>Pokud jste o reset hesla nežádali, můžete tento e-mail bezpečně ignorovat. Vaše heslo zůstane beze změny.</p>
            <div class="footer">
              <p>Toto je automatická zpráva, neodpovídejte na ni.</p>
              <p>RPA - Retail Prices Analyzer</p>
            </div>
          </div>
        </body>
      </html>
    `,
    text: `
Reset hesla

Dobrý den,

Obdrželi jste tento e-mail, protože jste (nebo někdo jiný) požádali o reset hesla pro váš účet v RPA Backend systému.

Pro dokončení resetu hesla otevřete následující odkaz ve vašem prohlížeči:
${resetUrl}

Tento odkaz vyprší za 1 hodinu.

Pokud jste o reset hesla nežádali, můžete tento e-mail bezpečně ignorovat. Vaše heslo zůstane beze změny.

---
Toto je automatická zpráva, neodpovídejte na ni.
RPA Backend - Retail Prices Analyzer
    `
  };

  try {
    const info = await transport.sendMail(mailOptions);
    console.log('Reset email odeslán:', info.messageId);
    return true;
  } catch (error) {
    console.error('Chyba při odesílání e-mailu:', error);
    return false;
  }
}

/**
 * Ověření e-mailové konfigurace
 * @returns {Promise<boolean>}
 */
export async function verifyEmailConfig() {
  const transport = getTransporter();
  
  if (!transport) {
    return false;
  }

  try {
    await transport.verify();
    console.log('Email konfigurace je validní');
    return true;
  } catch (error) {
    console.error('Email konfigurace není validní:', error.message);
    return false;
  }
}
