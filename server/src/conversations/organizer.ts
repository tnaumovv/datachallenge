import { z } from 'zod';
import { SourceConversationSchema } from '../../../shared/contracts.js';
import { HttpError } from '../errors.js';

const EnvelopeSchema = z.object({
  isSuccess: z.literal(true),
  error: z.string().nullable().optional(),
  data: z.object({
    dataset_group_id: z.string(),
    total_records: z.number().int().nonnegative(),
    records: z.array(SourceConversationSchema).min(1),
  }),
});
export type Fetcher = (url: URL, init?: RequestInit) => Promise<Response>;
export async function fetchOrganizerRecords(
  configuredUrl: string | undefined,
  groupId: string,
  fetcher: Fetcher = fetch,
) {
  if (!configuredUrl)
    throw new HttpError(503, 'SOURCE_NOT_CONFIGURED', 'Set ORGANIZER_API_URL on the server');
  try {
    const url = new URL(configuredUrl);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid URL protocol');
    url.searchParams.set('group_id', groupId);
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(30_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Upstream HTTP error');
    const envelope = EnvelopeSchema.parse(await response.json());
    if (
      envelope.error ||
      envelope.data.dataset_group_id !== groupId ||
      envelope.data.total_records !== envelope.data.records.length
    )
      throw new Error('Inconsistent upstream response');
    return envelope.data.records;
  } catch {
    // Upstream errors and URLs may contain credentials. Never send them to the client.
    throw new HttpError(
      502,
      'SOURCE_FAILED',
      'Organizer source failed or returned inconsistent data',
    );
  }
}
