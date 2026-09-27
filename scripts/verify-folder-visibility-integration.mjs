// Reuse real central login + two personal sites + member-session outage/expiry flows.
process.env.MINIHOMPY_VISIBILITY_INTEGRATION='1';
await import('./verify-member-session-integration.mjs');
