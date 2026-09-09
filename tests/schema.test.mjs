/**
 * Schema-level invariants, asserted against information_schema rather than
 * against the migration text -- what matters is the shape of the database that
 * actually exists.
 *
 *   PGDATABASE=impression node --test tests/schema.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const DB = process.env.PGDATABASE ?? "impression";
const q = (sql) =>
  execFileSync("psql", ["-d", DB, "-At", "-F", "|", "-c", sql], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((r) => r.split("|"));

test("no column stores a raw IP address (PRD 11)", () => {
  // Matched as a word, not as a substring: `stripe_session_id` contains "ip"
  // and a substring match would produce a false positive forever.
  const rows = q(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public'
      and (column_name ~ '(^|_)ip($|_)' or column_name ~ '(^|_)ip_address($|_)'
           or column_name ilike '%ipaddr%' or column_name ilike '%remote_addr%')`);
  assert.equal(rows.length, 0, `IP-bearing columns: ${JSON.stringify(rows)}`);
});

test("the delete token is required and is not exposed in any view", () => {
  const [[nullable]] = q(`
    select is_nullable from information_schema.columns
    where table_schema='public' and table_name='pieces' and column_name='delete_token'`);
  assert.equal(nullable, "NO");

  const views = q(`select table_name from information_schema.views where table_schema='public'`);
  assert.equal(views.length, 0, "a view could leak delete_token past RLS");
});

test("the event stream is stored as bytes, and durations as integers", () => {
  const types = Object.fromEntries(q(`
    select column_name, data_type from information_schema.columns
    where table_schema='public' and table_name='pieces'`));
  assert.equal(types.events, "bytea");
  assert.equal(types.duration_ms, "integer");
  assert.equal(types.seed, "bigint");
  assert.equal(types.is_public, "boolean");
});

test("row level security is enabled on every table (PRD 4b)", () => {
  const rows = q(`
    select c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'`);
  assert.ok(rows.length >= 4, "expected the four tables");
  for (const [name, enabled] of rows) {
    assert.equal(enabled, "t", `RLS is off on ${name}`);
  }
});

test("audio and stills cascade when a piece is deleted", () => {
  const rows = q(`
    select tc.table_name, rc.delete_rule
    from information_schema.table_constraints tc
    join information_schema.referential_constraints rc
      on rc.constraint_name = tc.constraint_name
    where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'
      and tc.table_name in ('piece_audio','piece_still')`);
  assert.equal(rows.length, 2);
  for (const [name, rule] of rows) assert.equal(rule, "CASCADE", `${name} does not cascade`);
});

test("the prompts referenced by pieces actually exist", () => {
  const [[count]] = q(`select count(*) from prompts`);
  assert.ok(Number(count) >= 7, `only ${count} prompts seeded`);
  const [[orphans]] = q(`
    select count(*) from pieces p
    left join prompts pr on pr.id = p.prompt_id
    where p.prompt_id is not null and pr.id is null`);
  assert.equal(Number(orphans), 0);
});
