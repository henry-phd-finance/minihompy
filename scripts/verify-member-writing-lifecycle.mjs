// Browser lifecycle suite reuses the real central/personal SQL fixture.
const [playwright,pglite]=process.argv.slice(2);
if(!playwright)throw Error('Usage: node scripts/verify-member-writing-lifecycle.mjs /path/to/playwright/index.mjs [/path/to/pglite/index.js]');
process.env.PLAYWRIGHT_PATH=playwright;
process.env.LIFECYCLE_BROWSER='1';
process.argv[2]=pglite;
await import('./verify-member-comments.mjs');
