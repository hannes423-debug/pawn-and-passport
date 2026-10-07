/**
 * mail/index.js - a pluggable transport for the one email the app sends.
 *
 *   const mailer = createMailer(config)
 *   await mailer.send({ to, subject, text, link })
 *
 * With SMTP_HOST unset (development, or a Pi without mail) the link is
 * printed to the server console, without the address it was meant for.
 * Tests pass their own mailer to buildApp and read what was "sent".
 */

import nodemailer from 'nodemailer';

export function createMailer(config, { print = (line) => console.log(line) } = {}) {
  if (!config.smtp) {
    return {
      kind: 'console',
      async send({ subject, link }) { print(`[mail] ${subject}: ${link}`); }
    };
  }
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined
  });
  return {
    kind: 'smtp',
    async send({ to, subject, text }) { await transport.sendMail({ from: config.smtp.from, to, subject, text }); }
  };
}

export default { createMailer };
