# Validates supabase/migrations/*.sql against a local PostgreSQL 17 by
# recreating the bits of the Supabase platform the migration depends on:
#   · the auth schema (auth.users, auth.uid(), auth.jwt())
#   · the storage schema (buckets, objects, foldername())
#   · the anon / authenticated / service_role roles
#   · the supabase_realtime publication
#
# The migration is then piped straight into psql, so the exact file that
# ships is the one that is tested.
#
#   powershell -ExecutionPolicy Bypass -File scripts\test-migration.ps1
param(
  [string]$Db = 'sawaari_supabase_test',
  [string]$Psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path $PSScriptRoot -Parent
$env:PGPASSWORD = 'postgres'
$mig = Join-Path $Root 'supabase\migrations\20261114000000_init.sql'

function PsqlRun([string]$sql, [string]$db = 'postgres') {
  $tmp = Join-Path $env:TEMP ("sqltest-" + [guid]::NewGuid().ToString('N').Substring(0, 8) + '.sql')
  [System.IO.File]::WriteAllText($tmp, $sql)
  & $Psql -U postgres -d $db -v ON_ERROR_STOP=1 -q -f $tmp 2>&1
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host "== resetting $Db ==" -ForegroundColor Cyan
PsqlRun "DROP DATABASE IF EXISTS $Db;" | Out-Null
PsqlRun "CREATE DATABASE $Db;" | Out-Null
Write-Host "  created"

Write-Host "== the Supabase platform shims ==" -ForegroundColor Cyan
$shim = @'
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text,
  encrypted_password text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  phone_verified boolean not null default false,
  created_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean not null default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text not null, owner_id text);
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$
  select case when array_length(string_to_array(name, '/'), 1) > 1
              then (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
              else '{}'::text[] end $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

-- the grants the real Supabase platform makes
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema storage to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
'@
PsqlRun $shim $Db | ForEach-Object { "  $_" }
Write-Host "  shims ready"

Write-Host "== applying the migration ==" -ForegroundColor Cyan
$out = PsqlRun (Get-Content $mig -Raw) $Db
$errors = @($out | Where-Object { $_ -match 'ERROR|FATAL' })
if ($errors.Count) {
  Write-Host "  x the migration FAILED:" -ForegroundColor Red
  $errors | Select-Object -First 15 | ForEach-Object { "    $_" }
  exit 1
}
Write-Host "  v the migration applied cleanly" -ForegroundColor Green

Write-Host "== second run (idempotency) ==" -ForegroundColor Cyan
$out2 = PsqlRun (Get-Content $mig -Raw) $Db
$errors2 = @($out2 | Where-Object { $_ -match 'ERROR|FATAL' })
if ($errors2.Count) {
  Write-Host "  x NOT idempotent:" -ForegroundColor Red
  $errors2 | Select-Object -First 15 | ForEach-Object { "    $_" }
  exit 1
}
Write-Host "  v running it twice is safe" -ForegroundColor Green

Write-Host "== what was created ==" -ForegroundColor Cyan
$check = @"
select
  (select count(*) from information_schema.tables where table_schema = 'public')          as tables,
  (select count(*) from pg_policies where schemaname = 'public')                          as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public')                                                          as functions,
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime')        as realtime_tables,
  (select count(*) from storage.buckets)                                                 as buckets,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity)                as rls_tables;
"@
PsqlRun $check $Db | ForEach-Object { "  $_" }

Write-Host "== behaviour: RLS, triggers, protection ==" -ForegroundColor Cyan
$rls = Join-Path $Root 'scripts\test-rls.sql'
$out3 = PsqlRun (Get-Content $rls -Raw) $Db
$pass = @($out3 | Where-Object { $_ -match 'PASS:' }).Count
$fail = @($out3 | Where-Object { $_ -match 'FAIL:' }).Count
$errs = @($out3 | Where-Object { $_ -match 'ERROR|FATAL' })
$out3 | Where-Object { $_ -match 'PASS:|FAIL:' } | ForEach-Object {
  $line = ($_ -split 'NOTICE:')[-1].Trim()
  "  $line"
}
if ($errs.Count) {
  Write-Host "  ! unexpected SQL errors:" -ForegroundColor Yellow
  $errs | Select-Object -First 5 | ForEach-Object { "    $_" }
}
Write-Host ("  RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 }
