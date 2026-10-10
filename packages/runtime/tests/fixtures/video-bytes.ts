import { readFileSync } from "node:fs";

// A fixed, decodable VP8 WebM, created for the existing CLI example fixture.
// Tests never generate video or contact a supplier.
export const validWebmBytes = readFileSync(new URL("../../../providers/examples/fixtures/sample.webm", import.meta.url));
export const validWebmWithAudioBytes = readFileSync(new URL("./video-with-audio.webm", import.meta.url));
