import { describe, expect, it } from "vitest";
import { videoOutputParametersFromBody } from "./video-output-contract.js";

describe("actual video output contract snapshot", () => {
  it("retains scalar output fields and nested Flow options without any auth, prompt or media", () => {
    expect(videoOutputParametersFromBody(JSON.stringify({ model: "omni_video_edit", prompt: "private", api_key: "private", video_url: "https://media.invalid/signed?secret=x",
      generationConfig: { videoConfig: { aspectRatio: "16:9", resolution: "1080p" } } }))).toEqual({ aspectRatio: "16:9", resolution: "1080p" });
    expect(videoOutputParametersFromBody(JSON.stringify({ duration: 5, audio: false, size: "1280x720", images: ["private"], width: 1280, height: 720 })))
      .toEqual({ duration: 5, audio: false, size: "1280x720", width: 1280, height: 720 });
    expect(videoOutputParametersFromBody(JSON.stringify({ audio: "https://media.invalid/audio.mp3" }))).toEqual({});
  });
  it("reads only declared scalar multipart fields and leaves Chat's default output unspecified", () => {
    const body = new FormData(); body.append("seconds", "5"); body.append("size", "1280x720"); body.append("input_reference", new Blob(["private"]));
    expect(videoOutputParametersFromBody(body)).toEqual({ seconds: "5", size: "1280x720" });
    expect(videoOutputParametersFromBody(JSON.stringify({ messages: [{ role: "user", content: "private" }], stream: false }))).toEqual({});
    expect(videoOutputParametersFromBody(undefined)).toEqual({});
  });
  it("normalizes only strict multipart output-audio booleans for sound acceptance checks", () => {
    for (const key of ["audio", "generate_audio", "generateAudio"]) {
      const body = new FormData(); body.append(key, "true");
      expect(videoOutputParametersFromBody(body)).toEqual({ [key]: true });
      body.set(key, "false"); expect(videoOutputParametersFromBody(body)).toEqual({ [key]: false });
      body.set(key, "https://media.invalid/voice.mp3"); expect(videoOutputParametersFromBody(body)).toEqual({});
      body.set(key, "voice-asset-id"); expect(videoOutputParametersFromBody(body)).toEqual({ [key]: "voice-asset-id" });
    }
  });
});
