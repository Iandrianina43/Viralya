/** Transcription horodatée d'un clip (ElevenLabs Scribe) — vérifie ce que Seedance a vraiment prononcé. */
import { transcribeWords } from "../src/providers/elevenlabs";
import { dialogueScore } from "../src/pipeline/hybrid";

const [url, ...expected] = process.argv.slice(2);
if (!url) throw new Error("usage: test-stt.ts <clip_url> [texte attendu]");
const t0 = Date.now();
const r = await transcribeWords(url);
console.log(`modèle ${r.model} en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("texte :", r.text);
console.log("mots  :", r.words.map((w) => `${w.w}@${w.s}`).join(" "));
if (expected.length) console.log("score :", dialogueScore(expected.join(" "), r.text));
process.exit(0);
