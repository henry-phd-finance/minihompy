import {friendPagesRelease} from '../setup/friend-visibility-release.mjs';
import {fileURLToPath} from 'node:url';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const destination = new URL('_site/', root);
// Only runtime files enter the Pages artifact, never SQL, tests or research.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
const files = ['index.html', 'styles.css', 'assets', 'views', 'login'];
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.js')) files.push(entry.name);
}
try {
  const proofs = await readdir(new URL('minihompy-identity/', root), { withFileTypes: true });
  await mkdir(new URL('minihompy-identity/', destination), { recursive: true });
  for (const proof of proofs) {
    if (!proof.isFile() || !/^[0-9a-f-]{36}\.json$/i.test(proof.name)) throw Error('Unexpected identity verification file');
    await cp(new URL('minihompy-identity/' + proof.name, root), new URL('minihompy-identity/' + proof.name, destination));
  }
} catch (error) { if (error.code !== 'ENOENT') throw error; }
for (const file of files) await cp(new URL(file, root), new URL(file, destination), { recursive: true });
await writeFile(new URL('.nojekyll', destination), '');
await writeFile(new URL('friend-visibility-release.json', destination),JSON.stringify(await friendPagesRelease(fileURLToPath(destination)),null,2)+'\n');
console.log(`Prepared _site with ${files.length} runtime entries. No references, docs, SQL or test scripts.`);
