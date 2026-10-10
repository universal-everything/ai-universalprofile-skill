// Node >= 22 ships fetch; this shim replaces the cross-fetch dependency of erc725.js.
const f = (...args) => globalThis.fetch(...args);
export default f;
export const fetch = f;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
