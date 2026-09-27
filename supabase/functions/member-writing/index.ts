import { handleMemberWriting } from './handler.js';
// Transport peer may be the shared gateway; never substitute caller forwarding headers.
Deno.serve((req, info) => handleMemberWriting(req, {transportPeerIp: info.remoteAddr.hostname}));
