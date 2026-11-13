import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Accept a caller-supplied request id only if it is short and made of safe characters
 * (prevents log injection); otherwise generate one. Always echoed in the response header.
 */
export function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  return resolveRequestIds(req, res).id;
}

export interface RequestIds {
  /** Correlation id echoed in `x-request-id` (caller-supplied if safe, else generated). */
  id: string;
  /** Always server-generated; the only id trusted for audit records (docs/AUTH.md §10). */
  serverId: string;
  /** Safe caller-supplied id, if any (stored only as `detail.clientRequestId`). */
  clientId: string | undefined;
}

export function resolveRequestIds(req: IncomingMessage, res: ServerResponse): RequestIds {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const clientId = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : undefined;
  const serverId = randomUUID();
  const id = clientId ?? serverId;
  res.setHeader(REQUEST_ID_HEADER, id);
  return { id, serverId, clientId };
}

/** Request augmentation set by the request-id middleware in `configureApp`. */
export interface RequestWithIds {
  id?: string;
  serverRequestId?: string;
  clientRequestId?: string;
}
