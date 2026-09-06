import { config } from "../config";
import { logger } from "../logger";

// E-mails transactionnels via Resend (POST https://api.resend.com/emails, doc du 7 sept. 2026) :
// contenu prêt à valider, échec de génération, alertes de budget. Jamais bloquant : sans clé,
// on ne fait rien ; en cas d'erreur, on journalise.
export const emailConfigured = (): boolean => !!config.RESEND_API_KEY;

export async function sendEmail(to: string[], subject: string, html: string, text?: string): Promise<{ id: string } | null> {
  const recipients = [...new Set(to.filter((e) => /\S+@\S+\.\S+/.test(e)))].slice(0, 50);
  if (!emailConfigured() || !recipients.length) return null;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: recipients, subject, html, ...(text ? { text } : {}) }),
  });
  if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { id?: string };
  logger.info("email_sent", { to: recipients.length, subject: subject.slice(0, 60), id: data.id });
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
