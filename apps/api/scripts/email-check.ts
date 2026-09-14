/**
 * Vérification de l'envoi d'e-mails (14 sept. 2026).
 *   pnpm --filter @viralya/api exec tsx scripts/email-check.ts                → transport détecté + test de connexion SMTP
 *   pnpm --filter @viralya/api exec tsx scripts/email-check.ts toi@exemple.fr → envoie un e-mail de test à cette adresse
 */
import { config } from "../src/config";
import { emailLayout, emailTransport, sendEmail, verifyEmail } from "../src/providers/email";

const to = process.argv[2];
const transport = emailTransport();
console.log(`transport : ${transport ?? "aucun (pose SMTP_HOST… ou RESEND_API_KEY)"} · expéditeur : ${config.EMAIL_FROM}`);
if (transport === "smtp") console.log(`SMTP : ${config.SMTP_HOST}:${config.SMTP_PORT ?? 587} · utilisateur : ${config.SMTP_USER ?? "(aucun)"} · secure : ${config.SMTP_SECURE ?? "auto"}`);
const v = await verifyEmail();
console.log(v.ok ? "connexion : OK" : `connexion : ÉCHEC — ${v.error ?? "transport absent"}`);
if (to && v.ok) {
  const r = await sendEmail([to], "Test Viralya : l'envoi d'e-mails fonctionne", emailLayout("Ça marche", "<p>Cet e-mail confirme que le serveur Viralya sait envoyer du courrier (confirmation d'adresse, mot de passe oublié, contenu prêt, alertes de crédits).</p>", { label: "Ouvrir Viralya", url: config.WEB_BASE_URL }));
  console.log(r ? `envoyé : ${r.id}` : "non envoyé");
}
