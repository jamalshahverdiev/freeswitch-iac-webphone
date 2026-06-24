// Call history (CDR) for the logged-in operator, fetched via the BFF (which
// scopes the query to the caller's own extension).
import { bffUrl } from "./config";

export interface CdrRow {
  id: string;
  direction: string;
  caller_id_number: string;
  caller_id_name: string;
  destination_number: string;
  hangup_cause: string;
  start_epoch: number;
  answer_epoch: number;
  billsec: number;
}

export async function fetchCdr(token: string, limit = 50): Promise<{ cdrs: CdrRow[]; total: number }> {
  const r = await fetch(`${bffUrl}/api/cdr?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`call history failed (${r.status})`);
  return r.json();
}
