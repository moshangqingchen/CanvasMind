import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface StoredObject {
  bytes: Uint8Array;
  contentType?: string;
}

export interface StoredObjectMetadata {
  size: number;
  contentType?: string;
  etag?: string;
  lastModified?: Date;
}

export interface ObjectStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete?(key: string): Promise<void>;
  /** Optional for compatibility with custom storage implementations. */
  head?(key: string): Promise<StoredObjectMetadata | null>;
  /** Reads an inclusive byte range. Callers must first validate it against head(). */
  getRange?(key: string, start: number, end: number): Promise<StoredObject | null>;
  healthCheck?(): Promise<void>;
  presignPut?(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn?: number,
  ): Promise<string>;
  publicUrl?(key: string): string | undefined;
}

function safeKey(key: string): string {
  const value = normalize(key).replace(/^([/\\])+/, "");
  if (value.includes("..")) throw new Error("Unsafe object key");
  return value;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.code === "ENOENT" ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function assertByteRange(start: number, end: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    throw new RangeError("Invalid byte range");
  }
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root = join(process.cwd(), "storage")) {}

  private pathFor(key: string): string {
    return join(this.root, safeKey(key));
  }

  private async readContentType(path: string): Promise<string | undefined> {
    try {
      const metadata = JSON.parse(
        await readFile(`${path}.metadata.json`, "utf8"),
      ) as { contentType?: unknown };
      return typeof metadata.contentType === "string"
        ? metadata.contentType
        : undefined;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    const path = join(this.root, safeKey(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    await writeFile(
      `${path}.metadata.json`,
      JSON.stringify({ contentType }),
      "utf8",
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        this.readContentType(path),
      ]);
      return { bytes, contentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    try {
      await Promise.all([
        unlink(path),
        unlink(`${path}.metadata.json`),
      ]);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const path = this.pathFor(key);
    try {
      const [details, contentType] = await Promise.all([
        stat(path),
        this.readContentType(path),
      ]);
      if (!details.isFile()) return null;
      return {
        size: details.size,
        contentType,
        lastModified: details.mtime,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getRange(
    key: string,
    start: number,
    end: number,
  ): Promise<StoredObject | null> {
    assertByteRange(start, end);
    const path = this.pathFor(key);
    let handle;
    try {
      handle = await open(path, "r");
      const details = await handle.stat();
      if (start >= details.size) throw new RangeError("Byte range starts past EOF");
      const lastByte = Math.min(end, details.size - 1);
      const bytes = new Uint8Array(lastByte - start + 1);
      const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, start);
      return {
        bytes: bytesRead === bytes.byteLength ? bytes : bytes.subarray(0, bytesRead),
        contentType: await this.readContentType(path),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      await handle?.close();
    }
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }

  publicUrl(key: string): string {
    return `/api/storage/${encodeURIComponent(key)}`;
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private ensured?: Promise<void>;

  constructor(
    private readonly bucket: string,
    options: NonNullable<ConstructorParameters<typeof S3Client>[0]>,
    publicEndpoint?: string,
  ) {
    this.client = new S3Client(options);
    this.presignClient = publicEndpoint
      ? new S3Client({ ...options, endpoint: publicEndpoint })
      : this.client;
  }

  private ensureBucket(): Promise<void> {
    this.ensured ??= this.client.send(new HeadBucketCommand({ Bucket: this.bucket }))
      .catch(async () => { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })); })
      .then(() => undefined);
    return this.ensured;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.ensureBucket();
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: bytes, ContentType: contentType }));
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
      if (!response.Body) return null;
      return { bytes: await response.Body.transformToByteArray(), contentType: response.ContentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      );
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }),
      );
      if (response.ContentLength === undefined)
        throw new Error("Object metadata is missing ContentLength");
      return {
        size: response.ContentLength,
        contentType: response.ContentType,
        etag: response.ETag,
        lastModified: response.LastModified,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getRange(
    key: string,
    start: number,
    end: number,
  ): Promise<StoredObject | null> {
    assertByteRange(start, end);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: safeKey(key),
          Range: `bytes=${start}-${end}`,
        }),
      );
      if (!response.Body) return null;
      return {
        bytes: await response.Body.transformToByteArray(),
        contentType: response.ContentType,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async healthCheck(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }

  async presignPut(
    key: string,
    contentType: string,
    contentLength: number,
    expiresIn = 600,
  ): Promise<string> {
    if (!Number.isSafeInteger(contentLength) || contentLength < 0)
      throw new RangeError("Invalid content length");
    await this.ensureBucket();
    return getSignedUrl(
      this.presignClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey(key),
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn },
    );
  }
}

const globalKey = "__superCanvasObjectStorage";

export function getObjectStorage(): ObjectStorage {
  const scope = globalThis as typeof globalThis & { [globalKey]?: ObjectStorage };
  if (scope[globalKey]) return scope[globalKey];
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) {
    scope[globalKey] = new LocalObjectStorage(process.env.LOCAL_STORAGE_PATH);
    return scope[globalKey];
  }

  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;
  if (Boolean(accessKey) !== Boolean(secretKey)) {
    throw new Error(
      "S3_ACCESS_KEY and S3_SECRET_KEY must be configured together",
    );
  }
  if ((!accessKey || !secretKey) && process.env.NODE_ENV === "production") {
    throw new Error(
      "S3_ACCESS_KEY and S3_SECRET_KEY are required in production",
    );
  }

  scope[globalKey] = new S3ObjectStorage(
    process.env.S3_BUCKET ?? "supercanvas",
    {
      endpoint,
      region: process.env.S3_REGION ?? "us-east-1",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      credentials: {
        accessKeyId: accessKey ?? "minioadmin",
        secretAccessKey: secretKey ?? "minioadmin",
      },
    },
    process.env.S3_PUBLIC_ENDPOINT,
  );
  return scope[globalKey];
}
