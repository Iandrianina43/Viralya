import { config } from "../config";
import { logger } from "../logger";
import { emailConfigured, emailLayout, sendEmail } from "../providers/email";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// NOTIFICATIONS (7 sept. 2026) : e-mail aux membres d'une organisation quand un contenu est prêt
// à valider, quand une génération échoue, et quand le budget du mois atteint 80 % puis 100 %.
// Jamais bloquant pour le pipeline ; silencieux sans RESEND_API_KEY.
// ─────────────────────────────────────────────────────────────

const cache = new Map<string, { emails: string[]; at: number }>();

/** E-mails des membres d'une organisation (cache 5 min). */
export async function orgEmails(orgId: string): Promise<string[]> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.emails;
  const { data: rows } = await supabase.from("memberships").select("user_id").eq("org_id", orgId);
  const ids = new Set((rows ?? []).map((r) => String(r.user_id)));
  const emails: string[] = [];
  if (ids.size) {
    const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 500 });
    for (const u of data?.users ?? []) if (ids.has(u.id) && u.email) emails.push(u.email);
  }
  cache.set(orgId, { emails, at: Date.now() });
  return emails;
}

async function notifyOrg(orgId: string, subject: string, html: string): Promise<void> {
  if (!emailConfigured()) return;
  try {
    await sendEmail(await orgEmails(orgId), subject, html);
  } catch (err) {
    logger.warn("notify_failed", { orgId, subject: subject.slice(0, 60), err: String((err as Error)?.message ?? err) });
  }
}

const site = () => config.WEB_BASE_URL.replace(/\/$/, "");

/** Contenu prêt à valider ou en échec. */
export async function notifyContentStatus(contentItemId: string, status: "needs_review" | "failed"): Promise<void> {
  if (!emailConfigured()) return;
  const { data: item } = await supabase.from("content_items").select("id, title, type, error, avatar_id").eq("id", contentItemId).maybeSingle();
  if (!item) return;
  const { data: avatar } = await supabase.from("avatars").select("name, org_id").eq("id", item.avatar_id).maybeSingle();
  if (!avatar?.org_id) return;
  const title = String(item.title ?? item.type);
  if (status === "needs_review") {
    await notifyOrg(
      String(avatar.org_id),
      `Prêt à valider : « ${title} »`,
      emailLayout(`« ${title} » est prête`, `<p>Le contenu de <strong>${avatar.name}</strong> vient d'être généré. Regarde-le, puis approuve-le ou demande une nouvelle version.</p>`, { label: "Ouvrir la revue", url: `${site()}/content` }),
    );
  } else {
    await notifyOrg(
      String(avatar.org_id),
      `Échec : « ${title} »`,
      emailLayout(`« ${title} » n'a pas abouti`, `<p>La génération pour <strong>${avatar.name}</strong> a échoué${item.error ? ` : <em>${String(item.error).slice(0, 200)}</em>` : ""}.</p><p>Tu peux la relancer depuis le Task Center ; rien n'est facturé pour un rendu refusé.</p>`, { label: "Voir le Task Center", url: `${site()}/tasks` }),
    );
  }
}

/** Compte social déconnecté par le réseau (jeton expiré ou révoqué) : il faut le reconnecter. */
export async function notifyConnectionLost(connectionId: string): Promise<void> {
  if (!emailConfigured()) return;
  const { data: conn } = await supabase.from("social_connections").select("org_id, avatar_id, networks, handle, meta").eq("id", connectionId).maybeSingle();
  if (!conn?.org_id) return;
  const { data: avatar } = conn.avatar_id ? await supabase.from("avatars").select("name").eq("id", conn.avatar_id).maybeSingle() : { data: null };
  const net = (conn.networks as string[] | null)?.[0] ?? "réseau";
  const reason = String((conn.meta as Record<string, unknown> | null)?.reason ?? "").slice(0, 160);
  await notifyOrg(
    String(conn.org_id),
    `Compte ${net} à reconnecter${avatar?.name ? ` (${avatar.name})` : ""}`,
    emailLayout(
      `Le compte ${net}${conn.handle ? ` @${conn.handle}` : ""} est déconnecté`,
      `<p>Le réseau a invalidé l'accès${reason ? ` : <em>${reason}</em>` : ""}. Les publications prévues sur ce réseau resteront en attente tant que le compte n'est pas reconnecté.</p>`,
      { label: "Reconnecter le compte", url: `${site()}/avatars/${conn.avatar_id ?? ""}/social` },
    ),
  );
}

/** Seuil de budget atteint (80 % ou 100 %). */
export async function notifyBudget(orgId: string, spentUsd: number, budgetUsd: number, level: 80 | 100): Promise<void> {
  await notifyOrg(
    orgId,
    level === 100 ? "Budget du mois épuisé" : "80 % du budget du mois utilisé",
    emailLayout(
      level === 100 ? "Budget mensuel atteint" : "Plus que 20 % de budget",
      `<p>${spentUsd.toFixed(2)} $ de génération utilisés sur ${budgetUsd.toFixed(2)} $ ce mois-ci.</p><p>${level === 100 ? "Les nouvelles générations sont bloquées jusqu'au mois prochain, sauf changement de forfait." : "Pense à passer au forfait supérieur si tu veux continuer à produire ce mois-ci."}</p>`,
      { label: "Gérer mon forfait", url: `${site()}/settings` },
    ),
  );
}
