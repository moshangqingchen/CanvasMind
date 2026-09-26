import { readFile } from "node:fs/promises";
import sharp from "sharp";

/** A real, decodable JPEG whose EXIF thumbnail contains an earlier EOI marker. */
export async function createJpegWithExifThumbnailFixture() {
  const icon = await readFile(
    new URL("../../../../assets/icon.png", import.meta.url),
  );
  const width = 312;
  const height = 196;
  const [original, thumbnail] = await Promise.all([
    sharp(icon).resize(width, height, { fit: "fill" }).jpeg().toBuffer(),
    sharp(icon).resize(32, 20, { fit: "fill" }).jpeg().toBuffer(),
  ]);

  // Little-endian TIFF: IFD0 has no entries and points to IFD1, which describes
  // an ordinary JPEG-compressed EXIF thumbnail. All offsets are TIFF-relative.
  const tiff = Buffer.alloc(56);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(0, 8);
  tiff.writeUInt32LE(14, 10);
  tiff.writeUInt16LE(3, 14);
  const entry = (offset: number, tag: number, type: number, value: number) => {
    tiff.writeUInt16LE(tag, offset);
    tiff.writeUInt16LE(type, offset + 2);
    tiff.writeUInt32LE(1, offset + 4);
    if (type === 3) tiff.writeUInt16LE(value, offset + 8);
    else tiff.writeUInt32LE(value, offset + 8);
  };
  entry(16, 0x0103, 3, 6); // Compression: JPEG.
  entry(28, 0x0201, 4, tiff.length); // JPEGInterchangeFormat offset.
  entry(40, 0x0202, 4, thumbnail.length); // JPEGInterchangeFormatLength.
  const exif = Buffer.concat([
    Buffer.from("Exif\0\0", "ascii"),
    tiff,
    thumbnail,
  ]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  const bytes = new Uint8Array(
    Buffer.concat([original.subarray(0, 2), app1, exif, original.subarray(2)]),
  );
  return { bytes, width, height };
}
