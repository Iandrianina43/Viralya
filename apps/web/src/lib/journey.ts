import { useEffect, useMemo, useState } from "react";
import { api, type Avatar, type ContentItem } from "../api";

// ─────────────────────────────────────────────────────────────
// PARCOURS UTILISATEUR (BRIEF § 3-4) — les huit étapes de Viralya, cochées d'après les
// données réelles de l'organisation. Partagé par le guide (/bienvenue) et le panneau
// « Premiers pas » du dashboard.
// ─────────────────────────────────────────────────────────────

export interface JourneyStep {
  key: string;
  title: string;
  short: string;
  /** Ce que l'utilisateur va faire, en 2-3 phrases simples. */
  explain: string;
  /** Points clés affichés en liste. */
  points: string[];
  /** Où le faire. */
  to: string;
  cta: string;
  done: boolean;
  /** Repère de coût, affiché tel quel. */
  cost?: string;
}

export interface Journey { steps: JourneyStep[]; done: number; next: JourneyStep | null; loading: boolean; avatars: Avatar[]; content: ContentItem[] }

const WELCOME_KEY = "viralya.welcome.seen";
export const welcomeSeen = (): boolean => { try { return localStorage.getItem(WELCOME_KEY) === "1"; } catch { return true; } };
export const markWelcomeSeen = (): void => { try { localStorage.setItem(WELCOME_KEY, "1"); } catch { /* stockage indisponible */ } };

export function useJourney(preloaded?: { avatars: Avatar[]; content: ContentItem[] }): Journey {
  const [avatars, setAvatars] = useState<Avatar[]>(preloaded?.avatars ?? []);
  const [content, setContent] = useState<ContentItem[]>(preloaded?.content ?? []);
  const [universe, setUniverse] = useState<boolean | null>(null);
  const [calendar, setCalendar] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(!preloaded);

  useEffect(() => {
    if (preloaded) { setAvatars(preloaded.avatars); setContent(preloaded.content); return; }
    Promise.all([api.listAvatars().then((r) => r.avatars).catch(() => [] as Avatar[]), api.listContent({ limit: 300 }).then((r) => r.content).catch(() => [] as ContentItem[])])
      .then(([a, c]) => { setAvatars(a); setContent(c); })
      .finally(() => setLoading(false));
  }, [preloaded?.avatars, preloaded?.content]);

  const first = avatars.find((a) => a.status !== "draft") ?? avatars[0];
  useEffect(() => {
    if (!first) { setUniverse(false); setCalendar(false); return; }
    api.listLocations(first.id, "all").then((r) => setUniverse(r.locations.length > 0)).catch(() => setUniverse(false));
    api.listPlans(first.id).then((r) => setCalendar(r.plans.length > 0)).catch(() => setCalendar(false));
  }, [first?.id]);

  const steps = useMemo<JourneyStep[]>(() => {
    const id = first?.id;
    const hasAvatar = avatars.length > 0 && avatars.some((a) => !!a.ref_image_url);
    const anyContent = content.length > 0;
    const reviewed = content.some((c) => ["scheduled", "published"].includes(c.status));
    const video = content.some((c) => c.type === "video" && !!(c.assets as { video_url?: string })?.video_url);
    const published = content.some((c) => c.status === "published");
    const ugc = content.some((c) => (c.payload as { kind?: string })?.kind === "ugc");
    return [
      {
        key: "avatar", title: "Créer ton influenceur", short: "Influenceur",
        explain: "Tu décris la personne : prénom, âge, ville, niche, caractère. Viralya écrit sa personnalité, choisit sa voix et génère son portrait de référence.",
        points: ["Un assistant te pose les questions, tu ajustes.", "Le portrait devient la référence de toutes les images et vidéos.", "La voix ElevenLabs est écoutée et choisie avant de valider."],
        to: "/avatars/create", cta: "Créer un influenceur", done: hasAvatar, cost: "≈ 0,10 $ pour le portrait",
      },
      {
        key: "universe", title: "Construire son univers", short: "Univers",
        explain: "Sa Character Bible : des vues de référence de son visage, sa garde-robe, et ses lieux (appartement, café, salle de sport, voyages). C'est ce qui rend le personnage cohérent d'un contenu à l'autre.",
        points: ["Les lieux ont une image de référence réutilisée partout.", "Les keyframes (elle dans un lieu, avec une tenue) sont générés une fois puis mis en cache.", "Le contrôle du visage vérifie chaque image."],
        to: id ? `/avatars/${id}/bible` : "/avatars", cta: "Ouvrir la Bible", done: !!universe, cost: "≈ 0,07 $ par image",
      },
      {
        key: "calendar", title: "Générer le calendrier", short: "Calendrier",
        explain: "Tu choisis le mois, la cadence et tes consignes (un voyage, un partenariat). Le stratège écrit des piliers, des séries et des arcs narratifs, puis un planning jour par jour où la même personne vit vraiment sa vie.",
        points: ["Chaque entrée décrit ce qu'elle vit ou montre, pas encore le texte parlé.", "Tu modifies, ignores ou ajoutes des entrées.", "Rien n'est produit tant que tu ne cliques pas « Produire »."],
        to: id ? `/avatars/${id}/calendar` : "/avatars", cta: "Voir le calendrier", done: !!calendar, cost: "quelques centimes",
      },
      {
        key: "content", title: "Générer du contenu", short: "Génération",
        explain: "Depuis une entrée du calendrier ou depuis le studio : photo, carrousel, story, ou vidéo. Pour une vidéo, le réalisateur écrit l'histoire, puis une prise unique de 20 à 30 secondes est rendue par Seedance 2.5 avec la voix du personnage.",
        points: ["Le coût est affiché avant de lancer.", "La production tourne en tâche de fond, tu peux quitter la page.", "Le suivi se fait dans Tâches et dans le studio."],
        to: id ? `/avatars/${id}/studio` : "/avatars", cta: "Ouvrir le studio", done: anyContent, cost: "photo ≈ 0,10 $ · vidéo 720p ≈ 11 $",
      },
      {
        key: "review", title: "Valider les générations", short: "Validation",
        explain: "Rien ne part sans toi. Chaque contenu arrive dans Contenus avec son image ou sa vidéo, sa légende, ses scores. Tu approuves, tu refuses, tu régénères, ou tu reviens à une version précédente.",
        points: ["Score visage et texte reconnu pour chaque plan.", "Un plan seul peut être régénéré, le montage est refait.", "Chaque génération est une version, on peut revenir en arrière."],
        to: "/content", cta: "Ouvrir la revue", done: reviewed,
      },
      {
        key: "video", title: "Obtenir la vidéo finale", short: "Vidéo",
        explain: "La vidéo finale est montée automatiquement : prise unique, inserts photo pendant la parole, musique de fond, mentions légales quand il le faut. Elle est prête à être publiée telle quelle.",
        points: ["Format vertical 1080×1920.", "Sous-titres karaoké en option.", "Le lien de la vidéo est dans la revue et dans le studio."],
        to: id ? `/avatars/${id}/studio` : "/avatars", cta: "Voir mes vidéos", done: video,
      },
      {
        key: "publish", title: "Programmer et publier", short: "Publication",
        explain: "Approuver programme le contenu à une heure. Il est publié sur le compte social du personnage : simulé dans Viralya (profil, feed, statistiques), ou réel dès qu'un compte est connecté.",
        points: ["« Publier maintenant » depuis la revue ou le compte.", "Le compte simulé a des abonnés et des statistiques qui vivent.", "La publication réelle passe par un fournisseur, avec le label « contenu IA »."],
        to: id ? `/avatars/${id}/social` : "/content", cta: "Voir le compte", done: published,
      },
      {
        key: "ugc", title: "Lancer une campagne UGC", short: "UGC",
        explain: "Une marque, un produit, des angles et des accroches : Viralya écrit une matrice de scripts en sept temps (accroche, problème, produit, démo, bénéfices, preuve, appel à l'action) et produit les vidéos que tu choisis.",
        points: ["Le produit est une image de référence dans la vidéo.", "Mentions « Collaboration commerciale » et « Images virtuelles » incrustées.", "Chaque variante se produit séparément, coût affiché."],
        to: "/ugc", cta: "Créer une campagne", done: ugc, cost: "scripts ≈ 0,03 $ · vidéo ≈ 12 $",
      },
    ];
  }, [avatars, content, universe, calendar, first?.id]);

  const done = steps.filter((s) => s.done).length;
  return { steps, done, next: steps.find((s) => !s.done) ?? null, loading: loading || universe === null || calendar === null, avatars, content };
}
