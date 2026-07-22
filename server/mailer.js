import nodemailer from "nodemailer";
import { config } from "./config.js";
import { listAdminEmails } from "./operationsRepository.js";

let transporter;

function smtpConfigured() {
  return Boolean(config.smtpHost && config.smtpUser && config.smtpPassword && config.smtpFrom);
}

function getTransporter() {
  if (!smtpConfigured()) {
    const error = new Error("Operational email is not configured.");
    error.statusCode = 503;
    error.code = "OPS_EMAIL_NOT_CONFIGURED";
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.smtpUser, pass: config.smtpPassword },
      disableFileAccess: true,
      disableUrlAccess: true
    });
  }
  return transporter;
}

export async function sendOperationsEmail({ subject, text, recipients } = {}) {
  const to = Array.isArray(recipients) && recipients.length ? recipients : await listAdminEmails();
  if (!to.length) {
    const error = new Error("No active administrator email recipients were found.");
    error.statusCode = 503;
    error.code = "OPS_EMAIL_NO_RECIPIENTS";
    throw error;
  }
  const result = await getTransporter().sendMail({
    from: config.smtpFrom,
    to,
    subject: String(subject || "Ziffer operations alert").slice(0, 180),
    text: String(text || "Ziffer generated an operational notification.").slice(0, 10000)
  });
  return { accepted: result.accepted || [], recipients: to };
}

export function operationsEmailConfigured() {
  return smtpConfigured();
}
