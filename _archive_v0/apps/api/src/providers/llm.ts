import { config } from "../config";
import { logger } from "../logger";

// ─────────────────────────────────────────────────────────────
// Provider IA texte — Anthropic (Claude) ou OpenAI (GPT).
// Fallback "stub" si aucune clé n'est configurée → le pipeline
// tourne quand même de bout en bout (utile pour la démo / CI).
// ─────────────────────────────────────────────────────────────

export async function generateText(
  system: string,
  user: string,
  opts?: { maxTokens?: number },
): Promise<string> {
  const maxTokens = opts?.maxTokens ?? 900;

  if (config.LLM_PROVIDER === "anthropic") {
    if (!config.ANTHROPIC_API_KEY) return stub();
    return callAnthropic(system, user, maxTokens);
  }
  if (!config.OPENAI_API_KEY) return stub();
  return callOpenAI(system, user, maxTokens);
}

async function callAnthropic(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

// Réponse factice déterministe (JSON attendu par le pipeline).
// Inclut à la fois "script" (formats texte) et "scenes" (format vidéo multi-scènes).
function stub(): string {
  logger.warn("llm_stub_used", { reason: "no api key configured" });
  return JSON.stringify({
    script:
      "Voici l'erreur n°1 qui bloque 90% des freelances : facturer au temps passé. " +
      "Passe à la valeur livrée et tes revenus décollent. Test-le cette semaine.",
    scenes: [
      { text: "90% des freelances font cette erreur sans le savoir.", role: "hook", background: "#0f1b3d" },
      { text: "Ils facturent au temps passé. Résultat : leurs revenus sont plafonnés par leurs heures.", role: "value", background: "#1a1a2e" },
      { text: "Passe à la facturation à la valeur livrée : même travail, revenus décuplés.", role: "value", background: "#16213e" },
      { text: "Teste-le sur ton prochain devis. Suis-moi pour la suite.", role: "cta", background: "#0f1b3d" },
    ],
    caption: "L'erreur qui plafonne tes revenus (et comment la corriger).",
    hashtags: ["#business", "#freelance", "#mindset", "#ia"],
    cta: "",
    memory_note: "A expliqué pourquoi facturer au temps plafonne les revenus des freelances.",
  });
}
