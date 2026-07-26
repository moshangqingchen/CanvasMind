import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export class CredentialError extends Error {
  public override readonly name = "CredentialError";

  public constructor(message: string) {
    super(message);
  }
}

function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function normalizeMasterKey(masterKey: string | Uint8Array): Buffer {
  if (masterKey instanceof Uint8Array) {
    if (masterKey.byteLength !== KEY_BYTES) {
      throw new CredentialError("The encryption key must contain 32 bytes");
    }
    return toBuffer(masterKey);
  }
  const value = masterKey.trim();
  if (value.length === 0) {
    throw new CredentialError("The encryption key cannot be empty");
  }
  if (/^[0-9a-f]{64}$/iu.test(value)) return Buffer.from(value, "hex");
  if (value.startsWith("base64:")) {
    const decoded = Buffer.from(value.slice("base64:".length), "base64");
    if (decoded.byteLength !== KEY_BYTES) {
      throw new CredentialError(
        "The base64 encryption key must decode to 32 bytes",
      );
    }
    return decoded;
  }
  return createHash("sha256").update(value, "utf8").digest();
}

function encode(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new CredentialError("Malformed encrypted credential");
  }
}

/** AES-256-GCM wire format: sc1.<iv>.<authTag>.<ciphertext>. */
export function encryptSecret(
  secret: string,
  masterKey: string | Uint8Array,
): string {
  if (secret.length === 0)
    throw new CredentialError("The credential cannot be empty");
  const key = normalizeMasterKey(masterKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `sc1.${encode(iv)}.${encode(authTag)}.${encode(ciphertext)}`;
}

export function decryptSecret(
  encrypted: string,
  masterKey: string | Uint8Array,
): string {
  const parts = encrypted.split(".");
  if (parts.length !== 4 || parts[0] !== "sc1") {
    throw new CredentialError("Malformed encrypted credential");
  }
  const iv = decode(parts[1] ?? "");
  const authTag = decode(parts[2] ?? "");
  const ciphertext = decode(parts[3] ?? "");
  if (iv.byteLength !== IV_BYTES || authTag.byteLength !== 16) {
    throw new CredentialError("Malformed encrypted credential");
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      normalizeMasterKey(masterKey),
      iv,
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new CredentialError("Unable to decrypt credential");
  }
}

export function maskSecret(secret: string): string {
  if (secret.length === 0) return "";
  if (secret.length <= 4) return "*".repeat(secret.length);
  return `${"*".repeat(Math.min(8, secret.length - 4))}${secret.slice(-4)}`;
}

export function redactHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const sensitive = /^(authorization|proxy-authorization|x-api-key|api-key)$/iu;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      sensitive.test(key) ? maskSecret(value) : value,
    ]),
  );
}

export interface SecretStore {
  get(connectionId: string): Promise<string | undefined>;
  set(connectionId: string, secret: string): Promise<void>;
  delete(connectionId: string): Promise<void>;
}

/** Public name used by persistence implementations backed by a database. */
export type CredentialStore = SecretStore;

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  public async get(connectionId: string): Promise<string | undefined> {
    return this.values.get(connectionId);
  }

  public async set(connectionId: string, secret: string): Promise<void> {
    this.values.set(connectionId, secret);
  }

  public async delete(connectionId: string): Promise<void> {
    this.values.delete(connectionId);
  }
}

/**
 * Encrypt-on-write wrapper for a persistent secret store. The wrapped store
 * only ever receives the authenticated ciphertext; callers get plaintext only
 * for the duration of an adapter request.
 */
export class EncryptedSecretStore implements SecretStore {
  public constructor(
    private readonly backend: SecretStore,
    private readonly masterKey: string | Uint8Array,
  ) {}

  public async get(connectionId: string): Promise<string | undefined> {
    const encrypted = await this.backend.get(connectionId);
    return encrypted === undefined
      ? undefined
      : decryptSecret(encrypted, this.masterKey);
  }

  public async set(connectionId: string, secret: string): Promise<void> {
    await this.backend.set(connectionId, encryptSecret(secret, this.masterKey));
  }

  public async delete(connectionId: string): Promise<void> {
    await this.backend.delete(connectionId);
  }
}

export interface ResolvedProviderConnectionLike {
  id: string;
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  headers?: Readonly<Record<string, string>>;
  settings?: Readonly<Record<string, unknown>>;
}

/** Test/local-development resolver; persistent deployments should use encrypted records. */
export class StaticConnectionResolver {
  private readonly connections = new Map<
    string,
    ResolvedProviderConnectionLike
  >();

  public constructor(
    connections: readonly ResolvedProviderConnectionLike[] = [],
  ) {
    for (const connection of connections)
      this.connections.set(connection.id, connection);
  }

  public add(connection: ResolvedProviderConnectionLike): void {
    this.connections.set(connection.id, connection);
  }

  public async resolve(
    connectionId: string,
  ): Promise<ResolvedProviderConnectionLike> {
    const connection = this.connections.get(connectionId);
    if (!connection)
      throw new CredentialError(`Unknown provider connection: ${connectionId}`);
    return connection;
  }
}

export type EncryptedProviderConnection = Omit<
  ResolvedProviderConnectionLike,
  "apiKey"
> & {
  encryptedApiKey?: string;
};

/**
 * Resolve connection records whose provider key is stored only in encrypted
 * form. The decrypted value exists solely in the returned object for the
 * duration of an adapter call and is never written back to the record.
 */
export class EncryptedConnectionResolver {
  private readonly connections = new Map<string, EncryptedProviderConnection>();

  public constructor(
    records: readonly EncryptedProviderConnection[],
    private readonly masterKey: string | Uint8Array,
  ) {
    for (const record of records) this.connections.set(record.id, record);
  }

  public add(record: EncryptedProviderConnection): void {
    this.connections.set(record.id, record);
  }

  public async resolve(
    connectionId: string,
  ): Promise<ResolvedProviderConnectionLike> {
    const record = this.connections.get(connectionId);
    if (!record)
      throw new CredentialError(`Unknown provider connection: ${connectionId}`);
    const { encryptedApiKey, ...connection } = record;
    const apiKey = encryptedApiKey
      ? decryptSecret(encryptedApiKey, this.masterKey)
      : undefined;
    return apiKey === undefined ? connection : { ...connection, apiKey };
  }
}
