import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

// ─────────────────────────────────────────────────────────────
// BANNIÈRE DE COMPTE (kit de lancement, 14 sept. 2026)
//   Le fond vient du modèle d'image ; l'ACCROCHE est composée ici (libass via ffmpeg-static, police
//   Poppins ExtraBold embarquée) : les modèles d'image rendent mal le texte et on ne peut pas le
//   corriger après coup. Le texte est placé dans la ZONE SÛRE du réseau, celle que tous les appareils
//   affichent (YouTube ne garantit que le centre 1546×423 d'une bannière 2560×1440).
// ─────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = resolve(here, "../../assets/fonts");
const FONT_NAME = "Poppins ExtraBold";
const FONT_FILE = "Poppins-ExtraBold.ttf";
const FF = ffmpegPath as unknown as string;

export interface SafeZone { x: number; y: number; w: number; h: number }
export interface BannerSpec {
  /** Taille du fichier livré (px). */
  w: number;
  h: number;
  /** Zone visible sur tous les appareils, dans le repère du fichier livré. */
  safe: SafeZone;
  /** Côté de l'accroche ; le sujet est demandé de l'autre côté dans le prompt. */
  textSide: "left" | "right";
  /** Ce que le réseau affiche (pour l'aide à l'écran). */
  note: string;
}

// Tailles et zones sûres vérifiées le 14 sept. 2026 (docs et guides 2026) :
//   YouTube : 2560×1440 recommandé (min 2048×1152, < 6 Mo) ; zone sûre centrée 1546×423.
//   Facebook : 851×315 affiché 820×312 (bureau) / 640×360 (mobile) ; zone sûre centrale 640×312 ;
//              la photo de profil recouvre le bas gauche sur mobile → accroche à droite. Livré en 2×.
//   X : 1500×500 ; la photo de profil recouvre le bas gauche → accroche à droite, marge basse.
//   Instagram et TikTok n'ont pas de bannière (photo de profil seulement).
export const BANNER_SPECS: Record<"youtube" | "facebook" | "x", BannerSpec> = {
  youtube: { w: 2560, h: 1440, safe: { x: 507, y: 508, w: 1546, h: 423 }, textSide: "left", note: "Téléphone : seule la bande centrale 1546×423 est visible ; bureau : toute la largeur, même bande ; TV : tout." },
  facebook: { w: 1702, h: 630, safe: { x: 211, y: 6, w: 1280, h: 618 }, textSide: "right", note: "Bureau 820×312, mobile 640×360 : garde l'essentiel au centre ; la photo de profil recouvre le bas gauche." },
  x: { w: 1500, h: 500, safe: { x: 150, y: 40, w: 1200, h: 380 }, textSide: "right", note: "La photo de profil recouvre le bas gauche ; les bords sont rognés selon l'écran." },
};

export const HOOK_MAX_CHARS = 40;
const LINE_MAX_CHARS = 18;

/** Coupe l'accroche en 1 à 3 lignes de ≤ 18 caractères (mots entiers), sans casser un mot trop long. */
export function wrapHook(hook: string): string[] {
  const words = hook.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= LINE_MAX_CHARS) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

const assEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");

function hookAss(spec: BannerSpec, hook: string): string {
  const lines = wrapHook(hook);
  const longest = Math.max(...lines.map((l) => l.length), 1);
  // Taille : tient en hauteur dans la zone sûre (interligne ≈ 1,2) ET en largeur sur 58 % de la zone (Poppins ExtraBold ≈ 0,56 em/caractère) — le sujet occupe le tiers opposé.
  const byHeight = (spec.safe.h * 0.86) / (lines.length * 1.2);
  const byWidth = (spec.safe.w * 0.58) / (longest * 0.56);
  const size = Math.max(28, Math.floor(Math.min(byHeight, byWidth)));
  const pad = Math.round(spec.safe.w * 0.03);
  const marginL = spec.textSide === "left" ? spec.safe.x + pad : 0;
  const marginR = spec.textSide === "right" ? spec.w - (spec.safe.x + spec.safe.w) + pad : 0;
  const align = spec.textSide === "left" ? 4 : 6; // milieu-gauche / milieu-droite
  const outline = Math.max(2, Math.round(size * 0.07));
  const shadow = Math.max(1, Math.round(size * 0.04));
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${spec.w}`,
    `PlayResY: ${spec.h}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Blanc, contour anthracite, ombre portée : lisible sur n'importe quel fond.
    `Style: Hook,${FONT_NAME},${size},&H00FFFFFF,&H00FFFFFF,&H00202020,&H90000000,-1,0,0,0,100,100,0,0,1,${outline},${shadow},${align},${marginL},${marginR},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,0:00:00.00,0:00:10.00,Hook,,0,0,0,,${lines.map(assEsc).join("\\N")}`,
    "",
  ].join("\n");
}

function ff(args: string[], cwd: string): Promise<void> {
  return new Promise((res, rej) => {
    execFile(FF, args, { timeout: 120_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, cwd }, (err, _out, stderr) => {
      if (err) rej(new Error(`ffmpeg: ${String(stderr).split("\n").slice(-6).join(" ").slice(0, 500)}`));
      else res();
    });
  });
}

/**
 * Compose la bannière : image source recadrée à la taille du réseau (recadrage centré) + accroche
 * dans la zone sûre. Sans accroche : simple recadrage. Renvoie un JPEG (qualité ≈ 90 %).
 */
export async function composeBanner(source: Buffer, spec: BannerSpec, hook: string | null): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "viralya-banner-"));
  try {
    await writeFile(join(dir, "src.img"), source);
    const filters = [`scale=${spec.w}:${spec.h}:force_original_aspect_ratio=increase`, `crop=${spec.w}:${spec.h}`];
    if (hook && hook.trim()) {
      await mkdir(join(dir, "fonts"), { recursive: true });
      await copyFile(join(FONTS_DIR, FONT_FILE), join(dir, "fonts", FONT_FILE));
      await writeFile(join(dir, "hook.ass"), hookAss(spec, hook.trim()), "utf8");
      filters.push("subtitles=hook.ass:fontsdir=fonts");
    }
    await ff(["-y", "-hide_banner", "-loglevel", "error", "-loop", "1", "-framerate", "1", "-i", "src.img", "-vf", filters.join(","), "-frames:v", "1", "-q:v", "2", "-pix_fmt", "yuvj420p", "out.jpg"], dir);
    return await readFile(join(dir, "out.jpg"));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
