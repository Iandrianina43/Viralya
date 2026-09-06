-- V2 — met HORS-JEU le worker de l'ancien déploiement (loomy-vps).
-- Il partage cette base et vole les jobs avec l'ancien code (pipeline Higgsfield),
-- ce qui corrompt les productions Seedance et dépense les anciens crédits.
-- Sans toucher au VPS : l'ancienne fonction claim_jobs ne rend plus rien,
-- et le code V2 local passe par claim_jobs_v2 (même logique qu'avant).

-- 1) L'ancien worker appelle claim_jobs → toujours 0 job, sans erreur.
create or replace function claim_jobs(p_worker text, p_limit int default 5)
returns setof jobs language sql as $$
  select * from jobs where false;
$$;

-- 2) La V2 reprend le claim atomique d'origine (FOR UPDATE SKIP LOCKED).
create or replace function claim_jobs_v2(p_worker text, p_limit int default 5)
returns setof jobs language plpgsql as $$
begin
  return query
  update jobs j
     set status='running', locked_at=now(), locked_by=p_worker,
         attempts=j.attempts+1, updated_at=now()
   where j.id in (
     select id from jobs
      where status='pending' and run_after <= now()
      order by run_after limit p_limit
      for update skip locked
   )
  returning j.*;
end; $$;
