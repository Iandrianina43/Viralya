import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

// Pages légales (7 sept. 2026). MODÈLE à faire relire par un juriste avant ouverture commerciale :
// les mentions entre crochets sont à compléter par l'éditeur (raison sociale, adresse, SIREN…).

const EDITOR_PLACEHOLDER = "[Éditeur : raison sociale, forme, capital, siège, RCS/SIREN, contact — à renseigner dans LEGAL_EDITOR]";
const UPDATED = "7 septembre 2026";

function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-3xl mx-auto px-5 py-10">
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="font-bold text-ink text-lg">← Viralya</Link>
          <div className="flex gap-4 text-sm text-slate-500">
            <Link to="/cgu" className="hover:text-ink">Conditions d'utilisation</Link>
            <Link to="/confidentialite" className="hover:text-ink">Confidentialité</Link>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-ink mb-2">{title}</h1>
        <p className="text-xs text-slate-400 mb-6">Dernière mise à jour : {UPDATED}. Document modèle, à faire valider avant ouverture commerciale.</p>
        <div className="prose prose-sm max-w-none text-slate-700 space-y-4 [&_h2]:text-ink [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-6">{children}</div>
      </div>
    </div>
  );
}

export function Legal({ page }: { page: "cgu" | "privacy" }) {
  const [EDITOR, setEditor] = useState(EDITOR_PLACEHOLDER);
  useEffect(() => { api.publicConfig().then((c) => { if (c.legal_editor) setEditor(c.legal_editor); }).catch(() => {}); }, []);
  if (page === "privacy") {
    return (
      <Page title="Politique de confidentialité">
        <p>Cette politique décrit les données traitées par Viralya, service d'édition de contenus pour influenceurs virtuels édité par {EDITOR}.</p>
        <h2>1. Données traitées</h2>
        <p>Compte : nom, adresse e-mail, mot de passe (haché), date d'acceptation des conditions. Espace de travail : influenceurs virtuels créés (fiche, images, voix de synthèse), contenus générés, calendrier, statistiques. Facturation : identifiant client et état d'abonnement Stripe (aucun numéro de carte n'est stocké par Viralya). Journal technique : adresses IP et horodatages des requêtes, conservés 30 jours pour la sécurité.</p>
        <h2>2. Finalités et bases légales</h2>
        <p>Fourniture du service et gestion du compte (exécution du contrat) ; facturation (obligation légale et contrat) ; sécurité et prévention des abus (intérêt légitime) ; e-mails de service — contenu prêt, échec, budget (exécution du contrat). Aucune prospection sans consentement.</p>
        <h2>3. Sous-traitants et transferts</h2>
        <p>Hébergement des données et authentification : Supabase. Génération de texte : Anthropic. Génération d'images et de vidéos : PiAPI (modèles ByteDance Seedance et Seedream). Voix et transcription : ElevenLabs. Paiement : Stripe. E-mails : Resend. Publication sur les réseaux (si activée) : Ayrshare. Certains prestataires sont situés hors de l'Union européenne ; les transferts s'appuient sur leurs clauses contractuelles types. Les textes, images et voix envoyés à ces prestataires servent uniquement à produire les contenus demandés.</p>
        <h2>4. Durées de conservation</h2>
        <p>Données du compte : pendant la durée du contrat puis 3 ans. Contenus générés : jusqu'à suppression par l'utilisateur ou clôture du compte. Factures : 10 ans (obligation comptable). Journaux techniques : 30 jours.</p>
        <h2>5. Vos droits</h2>
        <p>Accès, rectification, effacement, limitation, portabilité et opposition, via {EDITOR}. Vous pouvez saisir la CNIL en cas de désaccord. Les cookies se limitent à la session de connexion (aucun traceur publicitaire).</p>
        <h2>6. Sécurité</h2>
        <p>Connexions chiffrées (HTTPS), mots de passe hachés, clés des services d'IA conservées côté serveur, cloisonnement par organisation, sauvegardes de la base gérées par l'hébergeur.</p>
      </Page>
    );
  }
  return (
    <Page title="Conditions générales d'utilisation">
      <p>Viralya est un service en ligne qui permet de créer et d'animer des influenceurs virtuels (personnages générés par intelligence artificielle) et de produire des contenus pour les réseaux sociaux. Il est édité par {EDITOR}. L'utilisation du service vaut acceptation des présentes.</p>
      <h2>1. Compte et espace</h2>
      <p>Un compte est personnel. Chaque compte dispose d'un espace (organisation) qui peut accueillir d'autres membres invités par son propriétaire. Vous êtes responsable de la confidentialité de vos identifiants et des actions réalisées depuis votre compte.</p>
      <h2>2. Abonnement, budget et paiement</h2>
      <p>Les forfaits sont mensuels, payés par carte via Stripe, reconduits tacitement et résiliables à tout moment depuis Paramètres › Abonnement (effet à la fin de la période en cours). Chaque forfait comprend un budget mensuel de génération, exprimé en dollars, correspondant aux coûts d'intelligence artificielle engagés pour vous ; il n'est ni reportable ni remboursable. Les générations refusées ou échouées ne sont pas décomptées. Les prix peuvent évoluer avec un préavis de 30 jours.</p>
      <h2>3. Contenus générés</h2>
      <p>Les contenus produits (textes, images, vidéos, voix) sont générés par des modèles d'IA à partir de vos consignes. Vous en êtes responsable : exactitude, absence de propos illicites, respect des droits des tiers. Viralya ajoute une mention « contenu généré par IA » lorsque les plateformes de publication l'exigent et vous vous engagez à ne pas la retirer. Le service ne doit pas servir à imiter une personne réelle sans son accord, ni à diffuser des contenus trompeurs, haineux ou sexuellement explicites.</p>
      <h2>4. Vidéos de référence (clone)</h2>
      <p>La fonction « clone vidéo » reproduit la mise en scène d'une vidéo que vous fournissez. Vous garantissez détenir les droits nécessaires sur cette vidéo (vos propres tournages, banques d'images sous licence). Reproduire la vidéo d'un tiers sans autorisation engage votre seule responsabilité.</p>
      <h2>5. Propriété</h2>
      <p>Vous conservez vos droits sur les consignes et éléments que vous fournissez et disposez des contenus générés dans les limites des conditions des fournisseurs d'IA. Viralya reste propriétaire du service, de ses interfaces et de ses procédés.</p>
      <h2>6. Disponibilité et limites</h2>
      <p>Le service dépend de fournisseurs tiers (génération vidéo, voix, paiement, réseaux sociaux) ; des interruptions ou des résultats imparfaits peuvent survenir. Viralya s'engage à des moyens raisonnables, sans garantie de résultat, de délai ni d'audience. La responsabilité de l'éditeur est limitée au montant payé au cours des trois derniers mois.</p>
      <h2>7. Résiliation</h2>
      <p>Vous pouvez supprimer votre compte à tout moment. L'éditeur peut suspendre un compte en cas de violation des présentes, après notification sauf urgence. Les contenus sont supprimés dans les 30 jours suivant la clôture.</p>
      <h2>8. Droit applicable</h2>
      <p>Droit français. Tout litige relève des tribunaux compétents du siège de l'éditeur, après tentative de règlement amiable.</p>
    </Page>
  );
}
