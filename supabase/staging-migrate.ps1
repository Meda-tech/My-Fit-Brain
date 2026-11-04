# Applies new files from supabase/migrations to the STAGING database only.
# Never connects to production: it reads only STAGING_DB_URL from supabase/.env.db.
# Applied files are recorded in supabase_migrations.schema_migrations (the Supabase CLI table).
#
#   powershell -File supabase/staging-migrate.ps1            apply every file staging does not have yet
#   powershell -File supabase/staging-migrate.ps1 -List      only show what would run
#   powershell -File supabase/staging-migrate.ps1 -MarkAllApplied   record all files as applied, run nothing
#                                                             (used once, after loading the production schema)
#   powershell -File supabase/staging-migrate.ps1 -Run supabase/seed-staging.sql
#                                                             run one SQL file (seed, verify SQL) on staging
# Needs Docker running. The connection string is passed to the container as an environment variable,
# never on a command line, and is never printed.
param([switch]$List, [switch]$MarkAllApplied, [string]$Run)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $PSScriptRoot '.env.db'
$image = 'public.ecr.aws/supabase/postgres:17.11.0.011'

$url = $null
foreach ($l in Get-Content $envFile) {
  if ($l -match '^STAGING_DB_URL=postgresql://([^:]+):(.*)@([^@]+)$') {
    $pw = [uri]::EscapeDataString([uri]::UnescapeDataString($matches[2]))
    $url = 'postgresql://' + $matches[1] + ':' + $pw + '@' + $matches[3]
  }
  if ($l -match '^STAGING_STAFF_PASSWORD=(.+)$') { $env:STAGING_STAFF_PASSWORD = $matches[1].Trim() }
}
if (-not $url) { throw 'STAGING_DB_URL is missing in supabase/.env.db' }
if ($url -notmatch 'ndlqjmcpmkkulpinwbxe') { throw 'STAGING_DB_URL does not point to the staging project. Stopping.' }
$env:STAGING_DB_URL = $url

# Runs SQL text (-Sql, sent on stdin) or a repo file (-File, path relative to the repo root) on staging.
function Invoke-Staging([string]$Sql, [string]$File) {
  $target = if ($File) { "/repo/$File" } else { '/dev/stdin' }
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = $Sql | docker run --rm -i -e STAGING_DB_URL -e STAGING_STAFF_PASSWORD -v "${root}:/repo" --entrypoint sh $image -c "psql `$STAGING_DB_URL -v ON_ERROR_STOP=1 -tA -q -f $target" 2>&1
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  $out | ForEach-Object { "$_" -replace 'postgresql://\S+', '<db-url>' } | Where-Object { $_ -notmatch '^NOTICE:' }
  if ($code -ne 0) { throw "psql failed (exit $code)" }
}

if ($Run) {
  $rel = (Resolve-Path $Run).Path.Substring($root.Length + 1) -replace '\\', '/'
  "running on staging: $rel"
  Invoke-Staging -File $rel
  return
}

Invoke-Staging -Sql 'set client_min_messages = warning; create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);' | Out-Null
$applied = @(Invoke-Staging -Sql 'select version from supabase_migrations.schema_migrations;') | Where-Object { $_ -match '^\d+$' }

$files = Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name
$pending = $files | Where-Object { $applied -notcontains ($_.Name -split '_')[0] }
if (-not $pending) { 'Staging is up to date.'; return }

foreach ($f in $pending) {
  $version = ($f.Name -split '_')[0]
  $name = [IO.Path]::GetFileNameWithoutExtension($f.Name).Substring($version.Length + 1)
  if ($List) { "pending: $($f.Name)"; continue }
  if (-not $MarkAllApplied) {
    "applying: $($f.Name)"
    Invoke-Staging -File "supabase/migrations/$($f.Name)"
  }
  Invoke-Staging -Sql "insert into supabase_migrations.schema_migrations (version, name) values ('$version', '$name');" | Out-Null
  "recorded: $($f.Name)"
}
