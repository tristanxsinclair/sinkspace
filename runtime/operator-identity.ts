import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  verify as edVerify,
  type KeyObject
} from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * LAKE YANGE — LOCAL OPERATOR IDENTITY (development-grade)
 *
 * Ed25519 keypair per operator. The private key lives in a 0600 PEM file under
 * `.sink/operator/` and is held in the signer's private field. It is never
 * serialised, logged, or written to the economic event log. The log only ever
 * receives the public key and signatures.
 *
 * This is NOT an OS-keychain or hardware-backed key and is not production grade:
 * anyone who can read the key file or drive the signing route can sign.
 */

export const AUTH_VERSION = 1 as const;
export const DEFAULT_AUTH_TTL_MS = 5 * 60_000;
export const MAX_AUTH_TTL_MS = 10 * 60_000;
export const AUTH_DOMAIN = 'LAKE-YANGE-ECON-AUTH/1';

export const AUTH_OPERATIONS = [
  'ENROLL_OPERATOR',
  'REVOKE_OPERATOR',
  'APPROVE_ACTION',
  'REJECT_ACTION',
  'CANCEL_ACTION',
  'VERIFY_OUTCOME',
  'RETURN_OUTCOME'
] as const;
export type AuthOperation = (typeof AUTH_OPERATIONS)[number];

export const AuthorizationSchema = z.strictObject({
  version: z.literal(AUTH_VERSION),
  operation: z.enum(AUTH_OPERATIONS),
  operator_id: z.string().min(1).max(100),
  action_id: z.string().min(1).max(200).nullable(),
  scope_hash: z.string().length(64).nullable(),
  signed_at: z.iso.datetime(),
  valid_until: z.iso.datetime(),
  nonce: z.string().min(8).max(100),
  signature: z.string().min(80).max(120)
});
export type Authorization = z.infer<typeof AuthorizationSchema>;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

export type SignedFields = Omit<Authorization, 'signature'>;

/** The exact bytes signed: domain tag + canonical(auth fields + params). Params are the event payload minus authorization. */
export function authorizationMessage(fields: SignedFields, params: unknown): Buffer {
  return Buffer.from(`${AUTH_DOMAIN}\n${canonical({ ...fields, params })}`, 'utf8');
}

export function fingerprint(publicKeyB64: string): string {
  return createHash('sha256').update(Buffer.from(publicKeyB64, 'base64')).digest('hex').slice(0, 16);
}

/** Parses a base64 SPKI Ed25519 public key; throws on anything else. */
export function parsePublicKey(publicKeyB64: string): KeyObject {
  const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' });
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Operator key must be Ed25519.');
  return key;
}

export function verifySignature(publicKeyB64: string, message: Buffer, signatureB64: string): boolean {
  try {
    return edVerify(null, message, parsePublicKey(publicKeyB64), Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export interface SignRequest {
  operation: AuthOperation;
  action_id: string | null;
  scope_hash: string | null;
  params: unknown;
  now: Date;
  ttl_ms?: number | undefined;
  nonce?: string | undefined;
}

/** Holds the private key in a true private field; nothing enumerable or serialisable exposes it. */
export class OperatorSigner {
  readonly #key: KeyObject;
  readonly operator_id: string;
  readonly public_key: string;

  constructor(operatorId: string, privateKey: KeyObject) {
    this.#key = privateKey;
    this.operator_id = operatorId;
    this.public_key = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
  }

  get fingerprint(): string {
    return fingerprint(this.public_key);
  }

  sign(request: SignRequest): Authorization {
    const ttl = Math.min(request.ttl_ms ?? DEFAULT_AUTH_TTL_MS, MAX_AUTH_TTL_MS);
    const fields: SignedFields = {
      version: AUTH_VERSION,
      operation: request.operation,
      operator_id: this.operator_id,
      action_id: request.action_id,
      scope_hash: request.scope_hash,
      signed_at: request.now.toISOString(),
      valid_until: new Date(request.now.getTime() + ttl).toISOString(),
      nonce: request.nonce ?? randomUUID()
    };
    const signature = edSign(null, authorizationMessage(fields, request.params), this.#key).toString('base64');
    return { ...fields, signature };
  }

  toJSON(): { operator_id: string; public_key: string } {
    return { operator_id: this.operator_id, public_key: this.public_key };
  }
}

export const OPERATOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;

function keyPath(root: string, operatorId: string): string {
  if (!OPERATOR_ID_PATTERN.test(operatorId)) throw new Error('Invalid operator id.');
  return join(root, '.sink/operator', `${operatorId}.ed25519.pem`);
}

/** Creates a new key. Refuses to overwrite an existing one. */
export async function createOperatorSigner(root: string, operatorId: string): Promise<OperatorSigner> {
  const path = keyPath(root, operatorId);
  await mkdir(join(root, '.sink/operator'), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ format: 'pem', type: 'pkcs8' });
  await writeFile(path, pem, { flag: 'wx', mode: 0o600 });
  await chmod(path, 0o600);
  return new OperatorSigner(operatorId, privateKey);
}

export async function loadOperatorSigner(root: string, operatorId: string): Promise<OperatorSigner | null> {
  try {
    const pem = await readFile(keyPath(root, operatorId), 'utf8');
    return new OperatorSigner(operatorId, createPrivateKey(pem));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
