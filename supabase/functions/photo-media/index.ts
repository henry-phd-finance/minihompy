import {handlePhotoMedia} from './handler.js';
Deno.serve(req=>handlePhotoMedia(req));
