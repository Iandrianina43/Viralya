import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config";
import { logger } from "../logger";

// E-mails transactionnels : contenu prêt à valider, échec de génération, alertes de crédits, confirmation
// d'adresse, mot de passe oublié. Jamais bloquant : sans configuration on ne fait rien, en cas d'erreur on journalise.
//   1. SMTP (14 sept. 2026, choix de Jérôme) : SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE.
//   2. Repli : API Resend (RESEND_API_KEY) si aucun SMTP n'est posé.
export type EmailTransport = "smtp" | "resend" | null;

export const emailTransport = (): EmailTransport => (config.SMTP_HOST ? "smtp" : config.RESEND_API_KEY ? "resend" : null);
export const emailConfigured = (): boolean => emailTransport() !== null;

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (transporter) return transporter;
  const port = config.SMTP_PORT ?? 587;
  transporter = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port,
    // 465 = TLS implicite ; 587/25 = STARTTLS (négocié par nodemailer). SMTP_SECURE force le choix.
    secure: config.SMTP_SECURE != null ? config.SMTP_SECURE === "true" : port === 465,
    ...(config.SMTP_USER ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASS ?? "" } } : {}),
    connectionTimeout: 15_000,
    socketTimeout: 30_000,
  });
  return transporter;
}

/** Vérifie la connexion SMTP (utilisé par scripts/email-check.ts et /api/setup). */
export async function verifyEmail(): Promise<{ transport: EmailTransport; ok: boolean; error?: string }> {
  const transport = emailTransport();
  if (transport !== "smtp") return { transport, ok: transport === "resend" };
  try {
    await smtp().verify();
    return { transport, ok: true };
  } catch (err) {
    return { transport, ok: false, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

export async function sendEmail(to: string[], subject: string, html: string, text?: string): Promise<{ id: string } | null> {
  const recipients = [...new Set(to.filter((e) => /\S+@\S+\.\S+/.test(e)))].slice(0, 50);
  const transport = emailTransport();
  if (!transport || !recipients.length) return null;
  if (transport === "smtp") {
    const info = await smtp().sendMail({ from: config.EMAIL_FROM, to: recipients, subject, html, ...(text ? { text } : {}) });
    logger.info("email_sent", { transport, to: recipients.length, subject: subject.slice(0, 60), id: info.messageId, accepted: info.accepted?.length ?? 0, rejected: info.rejected?.length ?? 0 });
    return { id: String(info.messageId ?? "") };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: recipients, subject, html, ...(text ? { text } : {}) }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { id?: string };
  logger.info("email_sent", { transport, to: recipients.length, subject: subject.slice(0, 60), id: data.id });
  return { id: String(data.id ?? "") };
}

/** Gabarit minimal, lisible sur mobile, sans dépendance. */
export function emailLayout(title: string, bodyHtml: string, cta?: { label: string; url: string }): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1b1a">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <div style="font-weight:700;font-size:18px;margin-bottom:16px">Viralya</div>
  <div style="background:#fff;border:1px solid #e7e5e0;border-radius:14px;padding:24px">
    <h1 style="font-size:18px;margin:0 0 12px">${title}</h1>
    <div style="font-size:14px;line-height:1.55;color:#3f3d3a">${bodyHtml}</div>
    ${cta ? `<p style="margin:20px 0 0"><a href="${cta.url}" style="display:inline-block;background:#1c1b1a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:14px">${cta.label}</a></p>` : ""}
  </div>
  <p style="font-size:11px;color:#8a8783;margin-top:16px">Tu reçois cet e-mail parce que tu es membre d'un espace Viralya.</p>
</div></body></html>`;
}
