import { handleOwnerLogin } from './handler.js';
Deno.serve(req => handleOwnerLogin(req));
