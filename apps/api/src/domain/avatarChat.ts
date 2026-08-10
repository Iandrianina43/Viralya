import { extractJson } from "../lib/storage";
import { generateText, streamText } from "../providers/llm";

// ─────────────────────────────────────────────────────────────
// "Chat Ultime de Viralya" — Étape 1 : construction de la personnalité.
// L'IA discute (propose + affine) et met à jour la fiche du personnage
// en direct. Sans état serveur : le front envoie l'historique + le brouillon,
// l'API renvoie la réponse + le brouillon mis à jour.
// ─────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Brouillon = sous-ensemble de la fiche avatar (tous optionnels).
export interface AvatarDraft {
  name?: string;
  niche?: string;
  sex_age?: string;
  nationality?: string;
  city?: string;
  timezone?: string;
  personality?: string[];
  tone_of_voice?: string;
  values?: string[];
  backstory?: string;
  business_positioning?: string;
  target_audience?: string;
  products?: string[];
}

export interface ChatResult {
  reply: string;
  draft: AvatarDraft;
  ready: boolean; // la fiche est-elle assez complète pour passer au visage ?
}

const SYSTEM = `Tu es l'assistant de création d'influenceurs IA de VIRALYA.
Tu aides l'utilisateur à créer LE PERSONNAGE de son influenceur, en discutant comme un partenaire créatif : chaleureux, concret, tu proposes des idées quand l'utilisateur hésite.

À CHAQUE tour :
- Mets à jour la fiche du personnage (draft) avec tout ce que tu sais déjà + ce que l'utilisateur vient de dire. Ne perds JAMAIS une info déjà connue.
- Déduis le "timezone" IANA depuis la ville (ex : Dubaï → Asia/Dubai, Paris → Europe/Paris, Miami → America/New_York).
- Pose UNE seule question à la fois pour compléter ce qui manque (il manque souvent : niche, âge, ville, personnalité, ton, histoire, produits).
- Propose des suggestions concrètes plutôt que des questions vagues.
- Quand la fiche est assez riche (au minimum name, niche, sex_age, city, 3+ traits de personnalité, tone_of_voice, backstory), mets "ready": true et propose de passer à la génération du visage.

Champs du draft : name, niche, sex_age, nationality, city, timezone, personality[] (max 5), tone_of_voice, values[], backstory, business_positioning, target_audience, products[].

Réponds UNIQUEMENT en JSON valide :
{"reply": "<ce que tu dis à l'utilisateur, chaleureux, en français>", "draft": { ...fiche complète mise à jour... }, "ready": <true|false>}`;

export async function chatAvatar(messages: ChatMessage[], draft: AvatarDraft): Promise<ChatResult> {
  const convo = messages.map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"}: ${m.content}`).join("\n");
  const user = [
    `Fiche actuelle du personnage (à compléter / mettre à jour, ne rien perdre) :`,
    JSON.stringify(draft, null, 2),
    ``,
    `Conversation jusqu'ici :`,
    convo || "(l'utilisateur vient d'ouvrir le chat — accueille-le et demande-lui de décrire son influenceur)",
    ``,
    `Réponds en JSON {reply, draft, ready}.`,
  ].join("\n");

  const raw = await generateText(SYSTEM, user, 1200);
  const parsed = extractJson<ChatResult>(raw);
  if (!parsed) {
    // Fallback si le LLM ne renvoie pas de JSON exploitable (ou stub).
    return {
      reply: raw?.trim() || "Décris-moi ton influenceur : sa niche, son style, son histoire… et je construis sa fiche avec toi.",
      draft,
      ready: false,
    };
  }
  return {
    reply: parsed.reply ?? "",
    draft: { ...draft, ...(parsed.draft ?? {}) },
    ready: Boolean(parsed.ready),
  };
}

// ── Version STREAMING ────────────────────────────────────────
// Le LLM écrit d'abord sa réponse (texte streamé), puis un délimiteur, puis
// le JSON de la fiche. On streame le texte via onReplyToken ; on parse la fiche à la fin.
const DELIM = "§§§DATA§§§";

const SYSTEM_STREAM = `${SYSTEM}

FORMAT DE SORTIE STRICT (streaming) :
1) D'ABORD, écris ta réponse à l'utilisateur en texte simple (français, chaleureux). Pas de JSON ici.
2) PUIS, sur une nouvelle ligne, écris EXACTEMENT ${DELIM}
3) PUIS le JSON : {"draft": { ...fiche complète... }, "ready": <true|false>}
N'écris ABSOLUMENT RIEN après le JSON.`;

export async function chatAvatarStream(
  messages: ChatMessage[],
  draft: AvatarDraft,
  onReplyToken: (t: string) => void,
): Promise<{ draft: AvatarDraft; ready: boolean }> {
  const convo = messages.map((m) => `${m.role === "user" ? "Utilisateur" : "Assistant"}: ${m.content}`).join("\n");
  const user = [
    `Fiche actuelle (compléter / mettre à jour, ne rien perdre) :`,
    JSON.stringify(draft, null, 2),
    ``,
    `Conversation :`,
    convo || "(l'utilisateur vient d'ouvrir le chat — accueille-le et demande-lui de décrire son influenceur)",
  ].join("\n");

  let full = "";
  let emitted = 0;
  let delimFound = false;

  await streamText(SYSTEM_STREAM, user, (tok) => {
    full += tok;
    if (delimFound) return;
    const idx = full.indexOf(DELIM);
    if (idx !== -1) {
      if (idx > emitted) onReplyToken(full.slice(emitted, idx));
      emitted = idx;
      delimFound = true;
    } else {
      // On garde en réserve les derniers DELIM.length caractères (délimiteur potentiel à cheval).
      const safe = full.length - DELIM.length;
      if (safe > emitted) {
        onReplyToken(full.slice(emitted, safe));
        emitted = safe;
      }
    }
  });

  if (!delimFound) {
    if (full.length > emitted) onReplyToken(full.slice(emitted));
    const parsed = extractJson<{ draft?: AvatarDraft; ready?: boolean }>(full);
    return { draft: { ...draft, ...(parsed?.draft ?? {}) }, ready: Boolean(parsed?.ready) };
  }

  const dataStr = full.slice(full.indexOf(DELIM) + DELIM.length);
  const parsed = extractJson<{ draft?: AvatarDraft; ready?: boolean }>(dataStr) ?? {};
  return { draft: { ...draft, ...(parsed.draft ?? {}) }, ready: Boolean(parsed.ready) };
}
