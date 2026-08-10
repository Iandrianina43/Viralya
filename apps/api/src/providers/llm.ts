import { config } from "../config";
import { logger } from "../logger";

// Provider IA texte — Anthropic (Claude) ou OpenAI (GPT). Stub si pas de clé.
export async function generateText(system: string, user: string, maxTokens = 900): Promise<string> {
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
    body: JSON.stringify({ model: config.LLM_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? "";
}

async function callOpenAI(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

// ── Streaming (token par token) ──────────────────────────────
export async function streamText(
  system: string,
  user: string,
  onToken: (t: string) => void,
  maxTokens = 1200,
): Promise<string> {
  if (config.LLM_PROVIDER === "anthropic") {
    if (!config.ANTHROPIC_API_KEY) return streamStub(onToken);
    return streamAnthropic(system, user, onToken, maxTokens);
  }
  if (!config.OPENAI_API_KEY) return streamStub(onToken);
  return streamOpenAI(system, user, onToken, maxTokens);
}

async function readSse(body: ReadableStream<Uint8Array>, onEvent: (payload: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const l = line.trim();
      if (l.startsWith("data:")) onEvent(l.slice(5).trim());
    }
  }
}

async function streamAnthropic(system: string, user: string, onToken: (t: string) => void, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": config.ANTHROPIC_API_KEY as string, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: config.LLM_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }], stream: true }),
  });
  if (!res.ok || !res.body) throw new Error(`anthropic stream ${res.status}: ${await res.text()}`);
  let full = "";
  await readSse(res.body, (payload) => {
    if (payload === "[DONE]") return;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") {
        const t = evt.delta.text ?? "";
        full += t;
        onToken(t);
      }
    } catch { /* ignore keep-alive */ }
  });
  return full;
}

async function streamOpenAI(system: string, user: string, onToken: (t: string) => void, maxTokens: number): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: config.LLM_MODEL, max_tokens: maxTokens, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  if (!res.ok || !res.body) throw new Error(`openai stream ${res.status}: ${await res.text()}`);
  let full = "";
  await readSse(res.body, (payload) => {
    if (payload === "[DONE]") return;
    try {
      const evt = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
      const t = evt.choices?.[0]?.delta?.content ?? "";
      if (t) {
        full += t;
        onToken(t);
      }
    } catch { /* ignore */ }
  });
  return full;
}

function streamStub(onToken: (t: string) => void): string {
  logger.warn("llm_stream_stub_used", { reason: "no api key" });
  const s = "Décris-moi ton influenceur (niche, style, histoire) et je construis sa fiche avec toi. (Mode démo : clé LLM non configurée.)";
  onToken(s);
  return s;
}

function stub(): string {
  logger.warn("llm_stub_used", { reason: "no api key" });
  return JSON.stringify({
    scenes: [
      { text: "90% des freelances font cette erreur sans le savoir.", role: "hook", background: "#0f1b3d" },
      { text: "Ils facturent au temps passé. Leurs revenus sont plafonnés par leurs heures.", role: "value", background: "#1a1a2e" },
      { text: "Passe à la valeur livrée : même travail, revenus décuplés.", role: "value", background: "#16213e" },
      { text: "Teste-le sur ton prochain devis. Suis-moi pour la suite.", role: "cta", background: "#0f1b3d" },
    ],
    script: "90% des freelances facturent au temps passé. Passe à la valeur livrée.",
    caption: "L'erreur qui plafonne tes revenus.",
    hashtags: ["#business", "#freelance", "#ia"],
    cta: "",
    memory_note: "A expliqué pourquoi facturer à la valeur plutôt qu'au temps.",
  });
}
