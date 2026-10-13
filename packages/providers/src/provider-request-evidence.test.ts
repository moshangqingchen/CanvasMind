import {describe,expect,it} from "vitest";
import {providerResponseRequestEvidence,storedProviderRequestEvidence} from "./provider-request-evidence.js";

describe("bounded upstream response request identity",()=>{
  it("keeps real header and explicit JSON identities separate from local task IDs",()=>{
    const evidence=providerResponseRequestEvidence(new Headers({"X-Request-ID":"req-header-1","authorization":"Bearer secret","set-cookie":"secret"}),
      {request_id:"req-json-2",id:"local-or-task-id",upstream_request_id:"req-upstream-3",url:"https://result.test/?token=secret"});
    expect(evidence).toEqual({requestIds:["req-header-1","req-json-2","req-upstream-3"],observations:[
      {requestId:"req-header-1",source:"header:x-request-id"},{requestId:"req-json-2",source:"json:request_id"},{requestId:"req-upstream-3",source:"json:upstream_request_id"}]});
    expect(JSON.stringify(evidence)).not.toMatch(/secret|local-or-task-id|https:/u);
  });
  it("deduplicates a repeated header after JSON is read while retaining both source observations",()=>{
    const h=new Headers({"x-request-id":"same-1"}),first=providerResponseRequestEvidence(h);
    expect(providerResponseRequestEvidence(h,{request_id:"same-1"},first)).toEqual({requestIds:["same-1"],observations:[
      {requestId:"same-1",source:"header:x-request-id"},{requestId:"same-1",source:"json:request_id"}]});
  });
  it("preserves a synthetic New API response header with its exact provenance",()=>{
    const h=new Headers({"X-Oneapi-Request-Id":"200001010000000000000000000TESTREQUEST","x-request-id":"upstream-test-1","request-id":"unknown-not-captured"});
    const evidence=providerResponseRequestEvidence(h);
    expect(evidence?.observations).toEqual([
      {requestId:"upstream-test-1",source:"header:x-request-id"},
      {requestId:"200001010000000000000000000TESTREQUEST",source:"header:x-oneapi-request-id"},
    ]);
    expect(providerResponseRequestEvidence(h,undefined,evidence)).toEqual(evidence);
    for(const id of ["https://signed.test/?token=secret","sk-secret","Bearer.secret","x".repeat(201)])
      expect(providerResponseRequestEvidence(new Headers({"x-oneapi-request-id":id}))).toBeUndefined();
  });
  it("rejects credentials, URL/signed URL, whitespace, oversized IDs and unknown provenance",()=>{
    for(const requestId of ["https://x.test/?key=secret","Bearer secret","sk-12345678901234567890","eyJ.token.secret","id with space","x".repeat(201)])
      expect(providerResponseRequestEvidence(new Headers({"x-request-id":requestId}),{request_id:requestId})).toBeUndefined();
    expect(storedProviderRequestEvidence({requestIds:["invented"],observations:[{requestId:"invented",source:"local:idempotencyKey"}]})).toBeUndefined();
    expect(providerResponseRequestEvidence(new Headers(),{id:"native-task-only",requestId:"undeclared-field"})).toBeUndefined();
  });
});
