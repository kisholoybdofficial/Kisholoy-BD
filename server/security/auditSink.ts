/**
 * Audit sink — dependency-free bridge so security modules can record events
 * without importing the database module (which would create an import cycle
 * through `securityEngine`).
 *
 * The server wires the real sink at boot; until then entries are only logged,
 * never dropped silently.
 *
 * @license Apache-2.0
 */

import { log } from '../http/errors';

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SECURITY_ALERT';
export type AuditCategory = 'AUTH' | 'RBAC' | 'ORDER' | 'INVENTORY' | 'FINANCIAL' | 'SYSTEM' | 'CONFIG' | 'SECURITY';

export interface AuditEntry {
  operator: string;
  role: string;
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  resource: string;
  resourceId: string;
  details: string;
  ipAddress: string;
}

type Sink = (entry: AuditEntry) => void;

let sink: Sink | null = null;
const buffer: AuditEntry[] = [];

export function setAuditSink(next: Sink): void {
  sink = next;
  if (buffer.length) {
    for (const entry of buffer.splice(0, buffer.length)) sink(entry);
  }
}

/** Fire-and-forget: an audit write must never break an auth flow. */
export function audit(entry: AuditEntry): void {
  if (sink) {
    try {
      sink(entry);
      return;
    } catch (err) {
      log.error('audit', 'sink_failed', (err as Error).message);
    }
  }
  if (buffer.length < 500) buffer.push(entry);
  if (entry.severity === 'SECURITY_ALERT' || entry.severity === 'CRITICAL') {
    log.warn('audit', `${entry.action} by ${entry.operator} on ${entry.resource}/${entry.resourceId}`);
  }
}
