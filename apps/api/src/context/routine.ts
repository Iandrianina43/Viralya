// Routine de vie : le moment de la journée donne le ton.
export interface RoutineInfo {
  moment: string;
  tone: string;
}
export function getRoutine(hour: number): RoutineInfo {
  if (hour >= 5 && hour < 11) return { moment: "matin", tone: "énergie, motivation, mise en action" };
  if (hour >= 11 && hour < 15) return { moment: "midi", tone: "astuce concrète et rapide" };
  if (hour >= 15 && hour < 19) return { moment: "après-midi", tone: "preuve, résultat, insight de fond" };
  if (hour >= 19 && hour < 23) return { moment: "soirée", tone: "bilan, coulisses, ton plus personnel" };
  return { moment: "tard le soir", tone: "pensée sincère, ton intime" };
}
