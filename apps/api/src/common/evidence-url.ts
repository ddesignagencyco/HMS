// apps/api/src/common/evidence-url.ts
import type { ObjectStoragePort } from '../integrations/ports.js';

const EVIDENCE_BUCKET = 'evidence';
const EVIDENCE_URL_TTL_SECONDS = 300;

/**
 * A short-lived signed read URL for a stored evidence object, from the active storage port (mock or Supabase) — never a hand-built route.
 * An object the store cannot find answers `null`, so one missing file never fails the whole page that lists it.
 */
export async function signEvidenceUrl(storage: ObjectStoragePort, key: string): Promise<string | null> {
  try {
    const { url } = await storage.presignGet({ key, bucket: EVIDENCE_BUCKET, ttlSeconds: EVIDENCE_URL_TTL_SECONDS });
    return url;
  } catch {
    return null;
  }
}
