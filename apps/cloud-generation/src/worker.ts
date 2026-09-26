import { WorkflowEntrypoint } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import { handleRequest, executeGeneration } from "./core.mjs";
import { fetchViaTls, usesDirectTls } from "./tls-http.mjs";

export class GenerationWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    return executeGeneration({ ...this.env,
      submitFetchImpl: (url, init, limits) => usesDirectTls(url) ? fetchViaTls(connect, url, init, limits) : fetch(url, init),
      submitTransportName: url => usesDirectTls(url) ? "direct-tls" : "fetch",
    }, event.payload, step);
  }
}
export default { fetch: handleRequest };
