import {
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, normalize } from "node:path";
export * from "./project-files.js";

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
  putStream?(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObjectMetadata>;
  /** Lazy stream: no file is opened until consumed. */
  stream?(key: string): AsyncIterable<Uint8Array>;
  get(key: string): Promise<StoredObject | null>;
  delete?(key: string): Promise<void>;
  /** Optional for compatibility with custom storage implementations. */
  head?(key: string): Promise<StoredObjectMetadata | null>;
  /** Reads an inclusive byte range. Callers must first validate it against head(). */
  getRange?(
    key: string,
    start: number,
    end: number,
  ): Promise<StoredObject | null>;
  healthCheck?(): Promise<void>;
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
  private readonly pendingOperations = new Map<string, Promise<void>>();
  constructor(private readonly root = join(process.cwd(), "storage")) {}

  private pathFor(key: string): string {
    return join(this.root, safeKey(key));
  }

  /** Serialize access to the object/sidecar pair, including readers and deletion. */
  private async acquire(path: string): Promise<() => void> {
    const key = process.platform === "win32" ? path.toLowerCase() : path;
    const previous = this.pendingOperations.get(key);
    let complete!: () => void;
    const pending = new Promise<void>((resolve) => {
      complete = resolve;
    });
    this.pendingOperations.set(key, pending);
    await previous;
    return () => {
      complete();
      if (this.pendingOperations.get(key) === pending)
        this.pendingOperations.delete(key);
    };
  }

  private async readMetadata(path: string): Promise<{
    contentType?: string;
    size?: number;
    sha256?: string;
    mtimeMs?: number;
  }> {
    try {
      const metadata = JSON.parse(
        await readFile(`${path}.metadata.json`, "utf8"),
      ) as {
        contentType?: string;
        size?: number;
        sha256?: string;
        mtimeMs?: number;
      };
      return metadata;
    } catch (error) {
      if (isNotFound(error)) return {};
      throw error;
    }
  }

  private async readContentType(path: string): Promise<string | undefined> {
    const metadata = await this.readMetadata(path);
    return typeof metadata.contentType === "string"
      ? metadata.contentType
      : undefined;
  }

  async put(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    await this.putStream(
      key,
      (async function* () {
        yield bytes;
      })(),
      contentType,
    );
  }

  async putStream(
    key: string,
    chunks: AsyncIterable<Uint8Array>,
    contentType: string,
  ): Promise<StoredObjectMetadata> {
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    try {
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      const metadataTemporary = `${temporary}.metadata.json`;
      const hash = createHash("sha256");
      let size = 0;
      let replaced = false;
      async function* measured() {
        for await (const chunk of chunks) {
          size += chunk.byteLength;
          hash.update(chunk);
          yield chunk;
        }
      }
      try {
        await writeFile(temporary, measured(), { flag: "wx" });
        const details = await stat(temporary);
        const sha256 = hash.digest("hex");
        await writeFile(
          metadataTemporary,
          JSON.stringify({
            contentType,
            size,
            sha256,
            mtimeMs: details.mtimeMs,
          }),
          { flag: "wx" },
        );
        await rename(temporary, path);
        replaced = true;
        await rename(metadataTemporary, `${path}.metadata.json`);
        return { size, contentType, etag: sha256, lastModified: details.mtime };
      } catch (error) {
        // Never retain a checksum for an older object after replacing its bytes.
        if (replaced)
          await unlink(`${path}.metadata.json`).catch(() => undefined);
        throw error;
      } finally {
        await Promise.all(
          [temporary, metadataTemporary].map((file) =>
            unlink(file).catch(() => undefined),
          ),
        );
      }
    } finally {
      release();
    }
  }

  async *stream(key: string): AsyncIterable<Uint8Array> {
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    try {
      for await (const chunk of createReadStream(path)) yield chunk as Buffer;
    } finally {
      release();
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(path),
        this.readContentType(path),
      ]);
      return { bytes, contentType };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      release();
    }
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    try {
      await Promise.all(
        [path, `${path}.metadata.json`].map(async (file) => {
          try {
            await unlink(file);
          } catch (error) {
            if (!isNotFound(error)) throw error;
          }
        }),
      );
    } finally {
      release();
    }
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    try {
      const [details, metadata] = await Promise.all([
        stat(path),
        this.readMetadata(path),
      ]);
      if (!details.isFile()) return null;
      return {
        size: details.size,
        contentType:
          typeof metadata.contentType === "string"
            ? metadata.contentType
            : undefined,
        ...(metadata.size === details.size &&
        metadata.mtimeMs === details.mtimeMs &&
        typeof metadata.sha256 === "string"
          ? { etag: metadata.sha256 }
          : {}),
        lastModified: details.mtime,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      release();
    }
  }

  async getRange(
    key: string,
    start: number,
    end: number,
  ): Promise<StoredObject | null> {
    assertByteRange(start, end);
    const path = this.pathFor(key);
    const release = await this.acquire(path);
    let handle;
    try {
      handle = await open(path, "r");
      const details = await handle.stat();
      if (start >= details.size)
        throw new RangeError("Byte range starts past EOF");
      const lastByte = Math.min(end, details.size - 1);
      const bytes = new Uint8Array(lastByte - start + 1);
      const { bytesRead } = await handle.read(
        bytes,
        0,
        bytes.byteLength,
        start,
      );
      return {
        bytes:
          bytesRead === bytes.byteLength ? bytes : bytes.subarray(0, bytesRead),
        contentType: await this.readContentType(path),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    } finally {
      try {
        await handle?.close();
      } finally {
        release();
      }
    }
  }

  async healthCheck(): Promise<void> {
    await mkdir(this.root, { recursive: true });
  }
}

const globalKey = "__superCanvasObjectStorage";

export function getObjectStorage(): ObjectStorage {
  const scope = globalThis as typeof globalThis & {
    [globalKey]?: ObjectStorage;
  };
  if (scope[globalKey]) return scope[globalKey];
  scope[globalKey] = new LocalObjectStorage(process.env.LOCAL_STORAGE_PATH);
  return scope[globalKey];
}
