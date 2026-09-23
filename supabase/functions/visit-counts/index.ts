import {handleVisitCounts} from './handler.js';
Deno.serve(req=>handleVisitCounts(req));
