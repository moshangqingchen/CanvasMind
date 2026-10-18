import { describe, expect, it } from "vitest";
import { chuangxiangRejectedRequestFeeNotice } from "./chuangxiang-catalog-pricing.js";

describe("Chuangxiang announcement 38 conditional charge", () => {
  it.each(["grok-4.5", "grok-4.6", "grok-4.7", "grok-imagine-video", "grok-imagine-video-1.5", "gv3-grok-video-1.5"])("keeps the actual Grok ID %s bound to the announcement and sampling time", modelId => {
    expect(chuangxiangRejectedRequestFeeNotice("https://vapi.chuangxiangai.asia/v1", modelId)).toMatchObject({
      announcementId: 38, condition: "upstream-security-policy-rejection", amount: .05, currency: "CNY", unit: "request",
      sourceUrl: "https://vapi.chuangxiangai.asia/api/v1/announcements", publishedAt: "2026-10-17T20:57:41.883805+08:00",
      sampledAt: "2026-10-17T14:57:32.294Z",
    });
  });
  it.each(["https://api.hangzhale.com", "https://synoralink.com", "https://vapi.chuangxiangai.asia.evil.example", "http://vapi.chuangxiangai.asia",
    "https://secret@vapi.chuangxiangai.asia", "https://vapi.chuangxiangai.asia/v1?token=private", "https://vapi.chuangxiangai.asia/docs", "invalid"])("does not apply another source %s", source => {
    expect(chuangxiangRejectedRequestFeeNotice(source, "grok-4.7")).toBeUndefined();
  });
  it.each(["gpt-image-2.5", "gemini-4-argon", "claude-opus-5", "not-grok-4.7", "grok-unknown", "grok-4.7@s1c311"])("does not borrow the policy for %s", modelId => {
    expect(chuangxiangRejectedRequestFeeNotice("https://vapi.chuangxiangai.asia", modelId)).toBeUndefined();
  });
});
