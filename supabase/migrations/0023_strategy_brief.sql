-- 0023 — Analyse stratégique du profil (14 sept. 2026, demande de Jérôme).
-- Une IA lit la fiche d'identité (ce qu'il fait, ce qu'il vend, à qui) et en tire piliers, cadence, mix
-- et arcs proposés ; le stratège du calendrier s'en sert ensuite. Stockée sur l'influenceur, régénérable.
alter table avatars add column if not exists strategy_brief jsonb;
comment on column avatars.strategy_brief is 'Analyse du profil par le LLM : does, sells, audience, promise, pillars[], networks[], cadence_per_week, mix{}, month_theme, arcs[], tone, generated_at';
