import type { JobRow } from "../../queue/queue";
import { patchContentItem, requireContentItemId } from "../pipelines";

// V1 : marque publié (déclenchement manuel ou webhook outil de publication en Phase 2).
export async function publishJob(job: JobRow): Promise<void> {
  const id = requireContentItemId(job);
  await patchContentItem(id, { status: "published", published_at: new Date().toISOString() });
}
