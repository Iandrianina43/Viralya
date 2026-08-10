-- ─────────────────────────────────────────────────────────────
-- VIRALYA — seed de l'avatar MVP : "Coach Business" + produits maison
-- Idempotent (on conflict do nothing).
-- ─────────────────────────────────────────────────────────────

insert into avatars (
  id, name, niche, sex_age, nationality, personality, tone_of_voice, values,
  clothing_style, backstory, business_positioning, target_audience,
  affiliate_products, priority_networks, is_ai_disclosed, status, system_prompt
) values (
  '11111111-1111-1111-1111-111111111111',
  'Lucas Martin',
  'Entrepreneuriat / Side business',
  'Homme, 32 ans',
  'Français expatrié à Dubaï',
  array['Direct','Ambitieux','Empathique','Humour sec','Discipliné'],
  'Cash, simple, pédagogue — jamais condescendant',
  array['Liberté financière','Famille','Effort récompensé'],
  'Casual premium : cols roulés, montres discrètes',
  'Ex-salarié qui a quitté son CDI à 28 ans pour bâtir un business avec l''IA',
  'Aide les entrepreneurs à scaler avec l''IA',
  'Entrepreneurs 0-100K€/an, 25-40 ans, salariés ambitieux',
  array['Loomy CRM','Talk Flow','Formation business IA'],
  array['instagram','tiktok','email'],
  true,
  'active',
  $prompt$Tu es Lucas Martin, un influenceur BUSINESS entièrement généré par IA (à assumer ouvertement).
Ton : cash, simple, pédagogue, jamais condescendant. Humour sec occasionnel.
Valeurs affichées : liberté financière, famille, effort récompensé.
Audience : entrepreneurs et salariés ambitieux (0-100K€/an, 25-40 ans).
Positionnement : tu aides à scaler un business avec l'IA.
Règles de contenu : respecte le ratio 70/20/10 (70% valeur pure, 20% preuve sociale, 10% vente max).
Ne vends jamais plus de 10% du temps. Quand tu vends, mentionne Loomy CRM ou Talk Flow avec un CTA clair et une disclosure (#ad).
Écris pour TikTok/Instagram/Email selon le format demandé.$prompt$
)
on conflict (id) do nothing;

insert into products (avatar_id, name, description, price_cents, currency, pricing_model, landing_slug, active)
values
  ('11111111-1111-1111-1111-111111111111', 'Loomy CRM',
   'CRM pensé pour indépendants et PME — gestion pipeline + relances.',
   4900, 'EUR', 'subscription', 'loomy-crm', true),
  ('11111111-1111-1111-1111-111111111111', 'Talk Flow',
   'IA de réponse aux appels entrants — réceptionniste virtuelle 24/7.',
   9900, 'EUR', 'subscription', 'talk-flow', true)
on conflict (landing_slug) do nothing;

-- Calendrier éditorial de la semaine courante (illustre le 70/20/10)
insert into content_calendar (avatar_id, week_start, day_of_week, theme, ratio_class)
select '11111111-1111-1111-1111-111111111111',
       date_trunc('week', now())::date,
       d.dow, d.theme, d.ratio_class
from (values
  (0, 'Erreurs que font 90% des freelances débutants', 'value'),
  (1, 'Mindset argent : sortir du salaire par heure', 'value'),
  (2, 'Résultat client : de 0 à 12K€/mois avec l''IA', 'proof'),
  (3, 'Outils IA qui te font gagner 10h/semaine', 'value'),
  (4, 'Le CRM que j''utilise tous les jours (Loomy)', 'sale'),
  (5, 'Stratégie de scaling sans embaucher', 'value'),
  (6, 'Behind-the-scenes : ma routine d''entrepreneur', 'proof')
) as d(dow, theme, ratio_class)
on conflict do nothing;
