import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterAll, beforeAll, describe, expect, it, vi} from "vitest";
import {NodeParameterFields} from "../components/node-parameter-fields";
import {imageTransparencyEvidenceNote} from "./image-transparency-presentation";

describe("exact image transparency facts in the parameter panel", () => {
  beforeAll(() => vi.stubGlobal("React", React));
  afterAll(() => vi.unstubAllGlobals());
  it.each([
    ["verified", "透明已实测"], ["inferred", "透明推定可用"], ["declared", "透明接口声明"],
    ["rejected", "透明限制"], ["unverified", "透明资料未证实"],
  ] as const)("distinguishes %s evidence without changing saved values", (status,label) => {
    const current=Object.freeze({background:"transparent",output_format:"png",quality:"max",size:"3840x2160"});
    const onChange=vi.fn();
    const info={status,note:"当前精确分组参考图操作的结果；请求3840×2160，原图1672×941。"};
    const html=renderToStaticMarkup(React.createElement(NodeParameterFields, {nodeId:"transparent-evidence",nodeType:"image-generation",provider:"openai",model:{id:"gpt-image-2.5-flare",name:"Flare",operations:["image.generate","image.edit"],metadata:{imageCapabilityNote:"旧透明失败摘要"}},parameters:current,onChange,operation:"image.edit",transparentSupported:status!=="rejected"&&status!=="unverified",transparency:info}));
    expect(html).toContain(label);expect(html).toContain(info.note);expect(html).not.toContain("旧透明失败摘要");
    expect(onChange).not.toHaveBeenCalled();expect(current.background).toBe("transparent");
    if(status==="rejected"||status==="unverified"){
      expect(html).not.toContain(">透明模式</button>");expect(html).toContain("原值继续保留");
    }else expect(html).toContain(">透明模式</button>");
  });
  it("does not claim a result for missing evidence", () => {
    expect(imageTransparencyEvidenceNote()).toBeUndefined();
    expect(imageTransparencyEvidenceNote({status:"inferred",note:""})).toBeUndefined();
  });
});
