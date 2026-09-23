import { handleMemberWriting } from './handler.js';
Deno.serve(req => handleMemberWriting(req));
