import type { FileHandle } from "node:fs/promises";

type Kind = "audio" | "video";
interface Element { id: number; content: number; end?: number; }
const EBML = 0x1a45dfa3, SEGMENT = 0x18538067, TRACKS = 0x1654ae6b, TRACK = 0xae, TRACK_TYPE = 0x83;

/** Read EBML headers at their declared offsets, never search arbitrary payload
 * bytes for a track marker. Large clusters can be skipped without loading them. */
export async function webmMediaKind(handle: FileHandle, fileSize: number): Promise<Kind | undefined> {
  let remainingBytes = 512 * 1024;
  let elements = 0;
  const read = async (position: number, length: number): Promise<Buffer> => {
    if (!Number.isSafeInteger(position) || position < 0 || length < 0 || position + length > fileSize || length > remainingBytes) throw new Error("WebM inspection bound");
    remainingBytes -= length;
    const bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const part = await handle.read(bytes, offset, length - offset, position + offset);
      if (!part.bytesRead) throw new Error("Truncated WebM");
      offset += part.bytesRead;
    }
    return bytes;
  };
  const element = async (position: number, limit: number): Promise<Element> => {
    if (++elements > 2048 || position >= limit) throw new Error("WebM element bound");
    const header = await read(position, Math.min(12, limit - position));
    const length = (byte: number, maximum: number) => {
      for (let count = 1; count <= maximum; count++) if (byte & (1 << (8 - count))) return count;
      throw new Error("Invalid EBML integer");
    };
    const idLength = length(header[0]!, 4);
    if (header.length <= idLength) throw new Error("Truncated WebM header");
    const sizeLength = length(header[idLength]!, 8);
    if (idLength + sizeLength > header.length) throw new Error("Truncated WebM size");
    let id = 0;
    for (let i = 0; i < idLength; i++) id = id * 256 + header[i]!;
    let size = header[idLength]! & ((1 << (8 - sizeLength)) - 1);
    let unknown = size === ((1 << (8 - sizeLength)) - 1);
    for (let i = 1; i < sizeLength; i++) {
      size = size * 256 + header[idLength + i]!;
      unknown &&= header[idLength + i] === 255;
    }
    const content = position + idLength + sizeLength;
    if (!unknown && (!Number.isSafeInteger(size) || content + size > limit)) throw new Error("Invalid WebM element size");
    return { id, content, ...(!unknown ? { end: content + size } : {}) };
  };
  try {
    const ebml = await element(0, fileSize);
    if (ebml.id !== EBML || ebml.end === undefined) return;
    let position = ebml.end;
    while (position < fileSize) {
      const segment = await element(position, fileSize);
      if (segment.id !== SEGMENT) { if (segment.end === undefined) return; position = segment.end; continue; }
      const segmentEnd = segment.end ?? fileSize;
      position = segment.content;
      while (position < segmentEnd) {
        const child = await element(position, segmentEnd);
        if (child.end === undefined) return;
        if (child.id === TRACKS) {
          let audio = false, video = false, trackPosition = child.content;
          while (trackPosition < child.end) {
            const track = await element(trackPosition, child.end);
            if (track.end === undefined) return;
            if (track.id === TRACK) {
              let fieldPosition = track.content;
              while (fieldPosition < track.end) {
                const field = await element(fieldPosition, track.end);
                if (field.end === undefined) return;
                if (field.id === TRACK_TYPE) {
                  const width = field.end - field.content;
                  if (width < 1 || width > 4) return;
                  const type = (await read(field.content, width)).readUIntBE(0, width);
                  audio ||= type === 2; video ||= type === 1;
                }
                fieldPosition = field.end;
              }
            }
            trackPosition = track.end;
          }
          return video ? "video" : audio ? "audio" : undefined;
        }
        position = child.end;
      }
      return;
    }
  } catch { return; }
}
