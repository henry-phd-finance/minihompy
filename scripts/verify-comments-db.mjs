import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const admin = '10000000-0000-0000-0000-000000000001', writer = '10000000-0000-0000-0000-000000000002', other = '10000000-0000-0000-0000-000000000003';
async function as(uid, fn) {
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema storage to anon, authenticated;
    grant select, insert, update, delete on storage.objects to anon, authenticated;`);
  for (const file of ['202609130001_identity.sql', '202609130002_board.sql', '202609130003_settings.sql', '202609130004_photos.sql', '202609130005_diary.sql', '202609130006_guestbook.sql', '202609130007_guestbook_clock.sql', '202609130008_comments.sql', '202609130009_profile.sql', '202609130010_board_retry.sql', '202609230001_member_writing_foundation.sql', '202609230002_member_writing_sessions.sql', '202609230003_member_guestbook.sql', '202609230004_member_comments.sql']) await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  await db.query('insert into auth.users values ($1),($2),($3)', [admin, writer, other]);
  await db.query('insert into private.minihompy_admins values ($1)', [admin]);
  const parents = await as(admin, async () => {
    const board = (await db.query("insert into public.board_posts(folder_id,author_name,title,body) select id,'주인','게시판','본문' from public.board_folders returning id")).rows[0].id;
    const photo = '20000000-0000-0000-0000-000000000001';
    await db.query("insert into public.photo_posts(id,folder_id,author_name,title,body) select $1,id,'주인','사진',$2 from public.photo_folders", [photo, JSON.stringify([{ type: 'image', path: `${photo}/30000000-0000-0000-0000-000000000001.jpg` }])]);
    const diary = (await db.query("insert into public.diary_entries(id,folder_id,author_name,entry_date,entry_time,body) select gen_random_uuid(),id,'주인','2026-09-13','12:00','일기' from public.diary_folders returning id")).rows[0].id;
    const guestbook = (await db.query("insert into public.guestbook_posts(id,author_name,body) values(gen_random_uuid(),'주인','방명록') returning id")).rows[0].id;
    return { board_post_id: board, photo_post_id: photo, diary_entry_id: diary, guestbook_post_id: guestbook };
  });
  const insert = (column, id, body = '댓글') => db.query(`insert into public.post_comments(id,${column},author_name,body) values(gen_random_uuid(),$1,'방문자',$2) returning *`, [id, body]);
  const comments = {};
  for (const [column, id] of Object.entries(parents)) {
    await as(null, async () => await assert.rejects(insert(column, id)));
    await db.query("update private.comment_write_limits set last_write=now()-interval '1 minute'");
    await as(writer, async () => {
      comments[column] = (await insert(column, id)).rows[0];
      assert.equal(comments[column].author_id, writer);
      await assert.rejects(insert(column, id), /10초/);
    });
    await as(other, async () => {
      assert.equal((await db.query('select * from public.post_comments where id=$1', [comments[column].id])).rows.length, 1);
      assert.equal((await db.query("update public.post_comments set body='침입' where id=$1 returning id", [comments[column].id])).rows.length, 0);
      assert.equal((await db.query('delete from public.post_comments where id=$1 returning id', [comments[column].id])).rows.length, 0);
    });
  }
  const boardComment = comments.board_post_id.id, privateComment = comments.guestbook_post_id.id;
  await as(writer, async () => {
    for (const col of ['id', 'author_id', 'author_name', 'board_post_id', 'photo_post_id', 'diary_entry_id', 'guestbook_post_id', 'revision', 'created_at', 'updated_at']) await assert.rejects(db.query(`update public.post_comments set ${col}=${col}`));
    assert.equal((await db.query("update public.post_comments set body='수정' where id=$1 and revision=1 returning revision", [boardComment])).rows[0].revision, 2);
    assert.equal((await db.query("update public.post_comments set body='충돌' where id=$1 and revision=1 returning id", [boardComment])).rows.length, 0);
  });
  await as(admin, async () => {
    assert.equal((await db.query("update public.post_comments set body='관리자 수정' where id=$1 returning id", [boardComment])).rows.length, 0);
    await assert.rejects(insert('board_post_id', parents.board_post_id, ' \n\t'));
    await assert.rejects(insert('board_post_id', parents.board_post_id, 'x'.repeat(1001)));
    await assert.rejects(insert('board_post_id', '00000000-0000-0000-0000-000000000001'));
    await assert.rejects(db.query("insert into public.post_comments(id,author_name,body) values(gen_random_uuid(),'주인','본문')"));
    await assert.rejects(db.query("insert into public.post_comments(id,board_post_id,photo_post_id,author_name,body) values(gen_random_uuid(),$1,$2,'주인','본문')", [parents.board_post_id, parents.photo_post_id]));
    await db.query("update public.guestbook_posts set visibility='private' where id=$1", [parents.guestbook_post_id]);
  });
  // Even the comment author loses access when the parent is no longer visible.
  for (const uid of [null, writer, other]) await as(uid, async () => assert.equal((await db.query('select * from public.post_comments where id=$1', [privateComment])).rows.length, 0));
  await db.query("update private.comment_write_limits set last_write=now()-interval '1 minute'");
  await as(writer, async () => {
    await assert.rejects(insert('guestbook_post_id', parents.guestbook_post_id));
    assert.equal((await db.query("update public.post_comments set body='비밀 침입' where id=$1 returning id", [privateComment])).rows.length, 0);
  });
  await as(admin, async () => {
    assert.equal((await db.query('select * from public.post_comments where id=$1', [privateComment])).rows.length, 1);
    assert.equal((await db.query('delete from public.post_comments where id=$1 returning id', [boardComment])).rows.length, 1);
    await db.query('delete from public.photo_posts where id=$1', [parents.photo_post_id]);
    await db.query('delete from public.diary_entries where id=$1', [parents.diary_entry_id]);
    await db.query('delete from public.guestbook_posts where id=$1', [parents.guestbook_post_id]);
    assert.equal((await db.query('select * from public.post_comments')).rows.length, 0);
  });
  await db.query("update private.comment_write_limits set last_write=now()-interval '1 minute', writes=100 where user_id=$1", [writer]);
  await as(writer, async () => await assert.rejects(insert('board_post_id', parents.board_post_id), /24시간/));
  await db.query("update private.comment_write_limits set window_start=now()-interval '25 hours' where user_id=$1", [writer]);
  await as(writer, async () => {
    const row = (await insert('board_post_id', parents.board_post_id)).rows[0];
    await db.query('delete from public.post_comments where id=$1', [row.id]);
    await assert.rejects(insert('board_post_id', parents.board_post_id), /10초/);
  });
  console.log('PASS: actual parent migrations + comment RLS for all four targets, inherited privacy including former author, edit/delete ownership, immutable metadata/parent, revisions, FK cascades, rate limits. Local PGlite.');
} finally { await db.close(); }
