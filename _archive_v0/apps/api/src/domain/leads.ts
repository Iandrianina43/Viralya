import { randomUUID } from "node:crypto";
import { config } from "../config";
import { logger } from "../logger";
import { addToWelcomeList, sendDoubleOptinEmail } from "../providers/email";
import { supabase } from "../supabase";

// ─────────────────────────────────────────────────────────────
// M7 — logique métier des leads (double opt-in RGPD).
// Partagée entre l'endpoint JSON (/leads) et le formulaire SSR (/leads/form).
// ─────────────────────────────────────────────────────────────

export interface RegisterLeadInput {
  email: string;
  avatar_id: string;
  source?: string;
  utm?: Record<string, string>;
}

export async function registerLead(
  input: RegisterLeadInput,
): Promise<{ id: string; confirmUrl: string }> {
  const optin_token = randomUUID();
  const { data, error } = await supabase
    .from("leads")
    .upsert(
      {
        email: input.email,
        avatar_id: input.avatar_id,
        source: input.source ?? "landing",
        utm: input.utm ?? {},
        status: "pending_optin",
        optin_token,
      },
      { onConflict: "email,avatar_id" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`registerLead failed: ${error.message}`);

  const confirmUrl = `${config.API_BASE_URL}/leads/confirm?token=${optin_token}`;

  // Nom de l'avatar pour personnaliser l'email.
  const { data: avatar } = await supabase
    .from("avatars")
    .select("name")
    .eq("id", input.avatar_id)
    .single();

  await sendDoubleOptinEmail(input.email, confirmUrl, avatar?.name ?? "VIRALYA");
  logger.info("lead_optin_pending", { email: input.email, avatar: avatar?.name });
  return { id: data.id, confirmUrl };
}

export async function confirmLead(
  token: string,
): Promise<{ email: string; avatar_id: string } | null> {
  const { data, error } = await supabase
    .from("leads")
    .update({ status: "confirmed", confirmed_at: new Date().toISOString(), optin_token: null })
    .eq("optin_token", token)
    .select("email, avatar_id")
    .maybeSingle();
  if (error) throw new Error(`confirmLead failed: ${error.message}`);
  if (!data) return null;

  // Liste welcome Brevo → déclenche la séquence de bienvenue (automation côté Brevo).
  await addToWelcomeList(data.email, { AVATAR_ID: data.avatar_id });
  logger.info("lead_confirmed", { email: data.email });
  return data;
}
