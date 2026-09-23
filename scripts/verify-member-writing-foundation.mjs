import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.argv[2]) throw Error('Usage: node scripts/verify-member-writing-foundation.mjs /path/to/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1), writer = id(2), other = id(3), member = id(4), site = id(5);
const results = [];
async function check(name, fn) { await fn(); results.push(name); console.log(`PASS: ${name}`); }
async function as(uid, fn, role = uid ? 'authenticated' : 'anon') {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  try { return await fn(); }
  finally { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
}
const insertPost = (key, visibility = 'public') => db.query(
  "insert into public.guestbook_posts(id,author_name,body,visibility) values($1,'방문자','기존 본문',$2) returning *", [key, visibility]);
const insertComment = (key, parent, body = '댓글') => db.query(
  "insert into public.post_comments(id,guestbook_post_id,author_name,body) values($1,$2,'방문자',$3) returning *", [key, parent, body]);
const resetLimits = () => db.exec("update private.guestbook_write_limits set last_write=now()-interval '2 minutes'; update private.comment_write_limits set last_write=now()-interval '1 minute'");
const rows = table => db.query(`select * from public.${table} order by id`).then(r => r.rows);
const load = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select,insert,update,delete on storage.objects to anon, authenticated;`);
  for (const file of [
    '202609130001_identity.sql', '202609130002_board.sql', '202609130003_settings.sql',
    '202609130004_photos.sql', '202609130005_diary.sql', '202609130006_guestbook.sql',
    '202609130007_guestbook_clock.sql', '202609130008_comments.sql',
    '202609130009_profile.sql', '202609130010_board_retry.sql',
  ]) await db.exec(await load(file));
  await db.query('insert into auth.users values($1),($2),($3)', [admin, writer, other]);
  await db.query('insert into private.minihompy_admins values($1)', [admin]);
  await as(writer, () => insertPost(id(10)));
  await resetLimits();
  await as(writer, () => insertPost(id(11), 'private'));
  await as(admin, () => insertPost(id(12)));
  await as(writer, () => insertComment(id(20), id(10)));
  await resetLimits();
  await as(writer, () => insertComment(id(21), id(11)));
  const before = { guestbook_posts: await rows('guestbook_posts'), post_comments: await rows('post_comments') };
  // Simulate hosted default table grants; explicit revokes must still close access.
  await db.exec(`alter default privileges in schema private grant all on tables to anon, authenticated, service_role;
    grant usage on schema private to service_role;`);
  await db.exec(await load('202609230001_member_writing_foundation.sql'));

  await check('upgrade preserves every legacy value and local ownership', async () => {
    for (const table of Object.keys(before)) {
      const upgraded = await rows(table);
      assert.deepEqual(upgraded.map(({ author_kind, author_member_id, author_homepage_url, ...row }) => {
        assert.equal(author_kind, 'local'); assert.equal(author_member_id, null); assert.equal(author_homepage_url, null); return row;
      }), before[table]);
    }
  });
  await check('public/private reads and private-parent comments keep existing RLS', async () => {
    for (const uid of [null, other]) await as(uid, async () => {
      assert.equal((await rows('guestbook_posts')).length, 2);
      assert.deepEqual((await rows('post_comments')).map(r => r.id), [id(20)]);
      await assert.rejects(insertComment(id(22), id(11)));
    });
    for (const uid of [admin, writer]) await as(uid, async () => {
      assert.equal((await rows('guestbook_posts')).length, 3);
      assert.equal((await rows('post_comments')).length, 2);
    });
  });
  await check('browser and local administrator cannot inject or reassign member fields', async () => {
    for (const uid of [writer, admin]) await as(uid, async () => {
      for (const table of Object.keys(before)) {
        for (const [column, value] of [['author_kind', 'member'], ['author_member_id', member], ['author_homepage_url', 'https://a.example/']]) {
          await assert.rejects(db.query(`update public.${table} set ${column}=$1`, [value]), /permission denied/);
        }
      }
      await assert.rejects(db.query("insert into public.guestbook_posts(id,author_name,body,author_member_id) values($1,'A','x',$2)", [id(30), member]), /permission denied/);
      await assert.rejects(db.query("insert into public.post_comments(id,guestbook_post_id,author_name,body,author_kind) values($1,$2,'A','x','member')", [id(31), id(10)]), /permission denied/);
    });
  });
  await check('legacy edits, conflicts, moderation and one-way privacy still work', async () => {
    await as(other, async () => {
      assert.equal((await db.query("update public.guestbook_posts set body='other' where id=$1 returning id", [id(10)])).rows.length, 0);
      assert.equal((await db.query('delete from public.post_comments where id=$1 returning id', [id(20)])).rows.length, 0);
    });
    await as(writer, async () => {
      for (const [table, key] of [['guestbook_posts', id(10)], ['post_comments', id(20)]]) {
        assert.equal((await db.query(`update public.${table} set body='edited' where id=$1 and revision=1 returning revision`, [key])).rows[0].revision, 2);
        assert.equal((await db.query(`update public.${table} set body='stale' where id=$1 and revision=1 returning id`, [key])).rows.length, 0);
      }
    });
    await as(admin, async () => {
      await assert.rejects(db.query("update public.guestbook_posts set body='admin' where id=$1", [id(10)]), /다른 사람/);
      assert.equal((await db.query("update public.post_comments set body='admin' where id=$1 returning id", [id(20)])).rows.length, 0);
      await db.query("update public.guestbook_posts set visibility='private' where id=$1", [id(10)]);
      await assert.rejects(db.query("update public.guestbook_posts set visibility='public' where id=$1", [id(10)]), /다시 공개/);
    });
  });
  await check('legacy inserts, rate limits and deletes remain functional after upgrade', async () => {
    await resetLimits();
    await as(writer, async () => {
      await insertPost(id(40)); await assert.rejects(insertPost(id(41)), /1분/);
      await insertComment(id(42), id(40)); await assert.rejects(insertComment(id(43), id(40)), /10초/);
      await db.query('delete from public.post_comments where id=$1', [id(42)]);
      await db.query('delete from public.guestbook_posts where id=$1', [id(40)]);
      await assert.rejects(insertPost(id(41)), /1분/);
    });
    await as(admin, () => db.query('delete from public.post_comments where id=$1', [id(20)]));
  });
  // Trusted SQL fixtures only, not a member API: no new member DML grant is shipped.
  const seedMember = async (key, visibility) => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    try {
      await db.query(`insert into public.guestbook_posts(id,author_id,author_kind,author_member_id,author_homepage_url,author_name,body,visibility)
        values($1,null,'member',$2,'https://a.example/','A','member fixture',$3)`, [key, member, visibility]);
    } finally { await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
  };
  await check('member rows cannot be adopted by legacy UUIDs or mutated through old admin routes', async () => {
    await seedMember(id(50), 'public'); await seedMember(id(51), 'private');
    for (const uid of [null, writer, member]) await as(uid, async () => {
      assert.equal((await db.query('select id from public.guestbook_posts where id=$1', [id(50)])).rows.length, 1);
      assert.equal((await db.query('select id from public.guestbook_posts where id=$1', [id(51)])).rows.length, 0);
    });
    await as(admin, async () => {
      assert.equal((await db.query('select id from public.guestbook_posts where id=$1', [id(51)])).rows.length, 1);
      assert.equal((await db.query("update public.guestbook_posts set visibility='private' where id=$1 returning id", [id(50)])).rows.length, 0);
      assert.equal((await db.query('delete from public.guestbook_posts where id=$1 returning id', [id(50)])).rows.length, 0);
    });
    await assert.rejects(db.query("update public.guestbook_posts set author_member_id=$1 where id=$2", [other, id(50)]), /식별 정보/);
    await assert.rejects(db.query("update public.guestbook_posts set author_kind='member',author_member_id=$1,author_id=null,author_homepage_url='https://a.example/' where id=$2", [member, id(12)]), /식별 정보/);
  });
  await check('both tables enforce identity shape and immutable member metadata', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [admin]);
    try {
      await db.query(`insert into public.post_comments(id,guestbook_post_id,author_id,author_kind,author_member_id,author_homepage_url,author_name,body)
        values($1,$2,null,'member',$3,'https://a.example/','A','member comment')`, [id(52), id(50), member]);
      for (const table of Object.keys(before)) {
        const parentColumn = table === 'post_comments' ? ',guestbook_post_id' : '';
        const parentValue = table === 'post_comments' ? `,'${id(50)}'` : '';
        for (const [kind, localId, memberId, homepage] of [
          ['member', admin, member, 'https://a.example/'],
          ['member', null, null, 'https://a.example/'],
          ['member', null, member, 'javascript:alert(1)'],
          ['member', null, member, null],
          ['local', admin, member, null],
          ['unexpected', null, member, 'https://a.example/'],
        ]) await assert.rejects(db.query(`insert into public.${table}
          (id,author_name,body,author_kind,author_id,author_member_id,author_homepage_url${parentColumn})
          values(gen_random_uuid(),'A','x',$1,$2,$3,$4${parentValue})`, [kind, localId, memberId, homepage]), /check constraint/);
        await assert.rejects(db.query(`update public.${table} set author_name='spoof' where author_kind='member'`), /식별 정보/);
      }
    } finally { await db.query("select set_config('request.jwt.claim.sub', '', false)"); }
    await as(admin, async () => {
      assert.equal((await db.query('delete from public.post_comments where id=$1 returning id', [id(52)])).rows.length, 0);
      assert.equal((await db.query("update public.post_comments set body='spoof' where id=$1 returning id", [id(52)])).rows.length, 0);
    });
  });
  await check('session data stays private even with hosted default grants and BYPASSRLS', async () => {
    const tables = ['member_writing_site', 'member_writing_sessions', 'member_writing_limits', 'member_writing_requests'];
    for (const role of ['anon', 'authenticated', 'service_role']) await as(null, async () => {
      for (const table of tables) {
        await assert.rejects(db.query(`select * from private.${table}`), /permission denied/);
        await assert.rejects(db.query(`delete from private.${table}`), /permission denied/);
      }
    }, role);
    await db.query("insert into private.member_writing_site(site_id,central_api_url) values($1,'https://central.example/functions/v1/identity-api')", [site]);
    const session = async (key, target = site, proof = id(61), ttl = '15 minutes') => db.query(`
      insert into private.member_writing_sessions(id,site_id,member_id,central_session_id,proof_id,token_hash,central_grant,display_name,homepage_url,issued_at,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,'A','https://a.example/',now(),now()+$8::interval)`,
    [key, target, member, id(60), proof, key.replaceAll('-', '').repeat(2), key.replaceAll('-', '')+'abcdefghijk', ttl]);
    await session(id(62));
    await assert.rejects(session(id(63)), /unique/);
    await assert.rejects(session(id(64), other, id(64)), /foreign key/);
    await assert.rejects(session(id(65), site, id(65), '16 minutes'), /check constraint/);
    await assert.rejects(session(id(66), site, id(66), '0 minutes'), /check constraint/);
    await assert.rejects(db.query("update private.member_writing_sessions set token_hash='plaintext'"), /check constraint/);
    await assert.rejects(db.query("update private.member_writing_sessions set revoked_at=issued_at-interval '1 second'"), /check constraint/);
  });
  await check('limits and retry tombstones are independent of sessions and content lifetime', async () => {
    await db.query("insert into private.member_writing_limits values($1,$2,'guestbook',now(),now(),1)", [site, member]);
    await assert.rejects(db.query("insert into private.member_writing_limits values($1,$2,'guestbook',now(),now(),1)", [site, member]), /unique/);
    await db.query(`insert into private.member_writing_requests(site_id,member_id,request_id,operation,payload_hash,resource_id,result_revision)
      values($1,$2,$3,'guestbook.create',$4,$5,1)`, [site, member, id(70), 'a'.repeat(64), id(50)]);
    await assert.rejects(db.query(`insert into private.member_writing_requests(site_id,member_id,request_id,operation,payload_hash,resource_id,result_revision)
      values($1,$2,$3,'guestbook.delete',$4,$5,1)`, [site, member, id(70), 'b'.repeat(64), id(50)]), /unique/);
    await db.query('delete from public.guestbook_posts where id=$1', [id(50)]);
    await db.exec('delete from private.member_writing_sessions');
    assert.equal((await db.query('select * from private.member_writing_limits')).rows.length, 1);
    assert.equal((await db.query('select * from private.member_writing_requests')).rows.length, 1);
  });
  await check('central members need no local auth account; old deleted-account rows remain valid', async () => {
    assert.equal((await db.query('select * from auth.users where id=$1', [member])).rows.length, 0);
    await db.query('delete from auth.users where id=$1', [writer]);
    assert.equal((await db.query('select author_id,author_kind from public.guestbook_posts where id=$1', [id(11)])).rows[0].author_id, null);
    assert.equal((await db.query('select author_kind from public.post_comments where id=$1', [id(21)])).rows[0].author_kind, 'local');
  });
  console.log(`PASS: ${results.length} foundation groups. Local PGlite; no hosted database or content changed.`);
} finally { await db.close(); }
