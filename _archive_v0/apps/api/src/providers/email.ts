import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Provider email — Brevo (transactionnel + contacts/listes).
// Sans clé : stub loggé, le flux reste traversable en dev.
// ─────────────────────────────────────────────────────────────

const BREVO_BASE = "https://api.brevo.com/v3";

function headers(): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json",
    "api-key": config.BREVO_API_KEY as string,
  };
}

/** Envoi d'un email transactionnel simple. */
export async function sendTransactionalEmail(
  to: string,
  subject: string,
  html: string,
): Promise<void> {
  if (!config.BREVO_API_KEY) {
    logger.warn("email_stub_used", { to, subject });
    return;
  }
  const res = await fetch(`${BREVO_BASE}/smtp/email`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      sender: { email: config.BREVO_SENDER_EMAIL, name: config.BREVO_SENDER_NAME },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!res.ok) throw new Error(`brevo smtp ${res.status}: ${await res.text()}`);
}

/** Email de confirmation double opt-in (RGPD). */
export async function sendDoubleOptinEmail(
  to: string,
  confirmUrl: string,
  avatarName: string,
): Promise<void> {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h2 style="color:#0f1b3d">Confirme ton inscription</h2>
      <p>Tu as demandé à rejoindre la liste de <strong>${escapeHtml(avatarName)}</strong>.</p>
      <p>Pour valider ton inscription (et recevoir ton contenu), clique ici :</p>
      <p style="margin:28px 0">
        <a href="${confirmUrl}"
           style="background:#22a7f0;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none">
          Je confirme mon inscription
        </a>
      </p>
      <p style="color:#64748b;font-size:13px">
        Si tu n'es pas à l'origine de cette demande, ignore simplement cet email — aucune donnée ne sera conservée.
        <br/>Contenu proposé par un créateur généré par IA — VIRALYA.
      </p>
    </div>`;
  await sendTransactionalEmail(to, `Confirme ton inscription — ${avatarName}`, html);
}

/** Ajoute un contact confirmé à la liste welcome (déclenche l'automation Brevo). */
export async function addToWelcomeList(
  email: string,
  attributes: Record<string, string> = {},
): Promise<void> {
  if (!config.BREVO_API_KEY) {
    logger.warn("brevo_contact_stub_used", { email });
    return;
  }
  const res = await fetch(`${BREVO_BASE}/contacts`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      email,
      listIds: [config.BREVO_WELCOME_LIST_ID],
      updateEnabled: true,
      attributes,
    }),
  });
  // 400 "Contact already exist" est OK avec updateEnabled, mais on tolère aussi les doublons explicites.
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    if (!/already exist/i.test(body)) throw new Error(`brevo contacts ${res.status}: ${body}`);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
