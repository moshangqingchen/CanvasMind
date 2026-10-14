import {describe, expect, it} from "vitest";
import {imageOutputDimensionNotice, imageOutputTransparencyLabel} from "./image-output-notice";

describe("original image output facts", () => {
  it("shows the recorded original/request size discrepancy without deriving success from a preset", () => {
    const asset = {kind:"image" as const, metadata:{imageOutputDimensionNotice:"请求3840×2160，原图1672×941。"}};
    expect(imageOutputDimensionNotice(asset)).toBe("请求3840×2160，原图1672×941。");
    expect(imageOutputDimensionNotice({kind:"image",metadata:{size_tier:"4K",size:"3840x2160"}})).toBeUndefined();
    expect(imageOutputDimensionNotice({kind:"video",metadata:asset.metadata})).toBeUndefined();
  });
  it("requires both real transparent pixels and visible pixels, not just an alpha channel", () => {
    const metadata = {imageOutputVerified:true,imageHasAlpha:true,imageHasTransparentPixels:true,imageHasVisiblePixels:true};
    expect(imageOutputTransparencyLabel({kind:"image",metadata})).toBe("原图含真实透明像素");
    expect(imageOutputTransparencyLabel({kind:"image",metadata:{...metadata,imageHasVisiblePixels:false}})).toBe("原图没有可见主体");
    expect(imageOutputTransparencyLabel({kind:"image",metadata:{...metadata,imageHasTransparentPixels:false}})).toBe("原图不透明");
    expect(imageOutputTransparencyLabel({kind:"image",metadata:{imageOutputVerified:true,imageHasTransparentPixels:true}})).toBe("原图含透明像素（主体信息未记录）");
    expect(imageOutputTransparencyLabel({kind:"image",metadata:{imageHasAlpha:true,background:"transparent"}})).toBeUndefined();
    expect(imageOutputTransparencyLabel({kind:"image",metadata:{imageOutputVerified:true,imageHasAlpha:true}})).toBeUndefined();
  });
});
