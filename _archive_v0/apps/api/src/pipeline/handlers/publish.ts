import type { JobRow } from "../../queue/queue";
import { patchContentItem, requireContentItemId } from "../pipelines";

// MVP : marque publié (l'envoi réel se fait via le provider de planification).
// Peut être déclenché par un webhook Buffer/Publer "posted" plus tard.
export async function publishJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  await patchContentItem(id, { status: "published", published_at: new Date().toISOString() });
}
