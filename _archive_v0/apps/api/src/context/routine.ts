// ─────────────────────────────────────────────────────────────
// Routine de vie : le moment de la journée donne le ton du contenu
// (comme un vrai humain avec un rythme).
// ─────────────────────────────────────────────────────────────

export interface RoutineInfo {
  moment: string;
  tone: string;
}

export function getRoutine(hourLocal: number): RoutineInfo {
  if (hourLocal >= 5 && hourLocal < 11)
    return { moment: "matin", tone: "énergie, motivation, mise en action pour la journée" };
  if (hourLocal >= 11 && hourLocal < 15)
    return { moment: "midi", tone: "astuce concrète et actionnable, format rapide" };
  if (hourLocal >= 15 && hourLocal < 19)
    return { moment: "après-midi", tone: "preuve, résultat, insight de fond" };
  if (hourLocal >= 19 && hourLocal < 23)
    return { moment: "soirée", tone: "bilan, coulisses, réflexion plus personnelle" };
  return { moment: "tard le soir", tone: "pensée sincère, ton intime et posé" };
}
