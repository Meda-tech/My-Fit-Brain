# READ-ONLY tools for PRODUCTION, run by the owner (Claude never runs this against production).
# It reads PROD_DB_URL from supabase/.env.db, hands it to Docker as an environment variable and never prints it.
# Nothing here can change production: every query runs in a read-only session, and pg_dump only reads.
#
#   powershell -File supabase/prod-readonly.ps1 -Backup
#       Full backup into D:\Tech\Meda\backups\prod-<date>-<time>\ (outside the project, never in git):
#       full.dump (pg_dump -Fc, every schema incl. auth and storage), schema.sql, data.sql. Prints the sizes.
#   powershell -File supabase/prod-readonly.ps1 -Check docs/tasks/23-calls-go-live-verify.sql
#       Runs a check file (SELECT only) and prints EVERY row (the SQL Editor shows only the last query's result).
#       Each check row ends in |t (true) or |f (false).
#
#   -UseStaging   the same against STAGING (only to try the script out).
# Needs Docker running. Run from the repo root.
param([switch]$Backup, [string]$Check, [switch]$UseStaging, [string]$BackupRoot = 'D:\Tech\Meda\backups')
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$image = 'public.ecr.aws/supabase/postgres:17.11.0.011'   # pg_dump 17.11 = production's Postgres 17.11
$name = if ($UseStaging) { 'STAGING_DB_URL' } else { 'PROD_DB_URL' }
$ref = if ($UseStaging) { 'ndlqjmcpmkkulpinwbxe' } else { 'tmifixelvfdtutsakwor' }

$url = $null
foreach ($l in Get-Content (Join-Path $PSScriptRoot '.env.db')) {
  if ($l -match "^$name=postgresql://([^:]+):(.*)@([^@]+)$") {
    $pw = [uri]::EscapeDataString([uri]::UnescapeDataString($matches[2]))
    $url = 'postgresql://' + $matches[1] + ':' + $pw + '@' + $matches[3]
  }
}
if (-not $url) { throw "$name is missing in supabase/.env.db" }
if ($url -notmatch $ref) { throw "$name does not point to the expected project. Stopping." }
$env:DB_URL = $url
$env:PGOPTIONS = '-c default_transaction_read_only=on'

function Clean($out) { $out | ForEach-Object { "$_" -replace 'postgresql://\S+', '<db-url>' } }

if ($Check) {
  $rel = (Resolve-Path $Check).Path.Substring($root.Length + 1) -replace '\\', '/'
  "checking ($name, read-only): $rel"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  # The read-only setting is sent first in the same session (the connection pooler ignores PGOPTIONS).
  $out = docker run --rm -e DB_URL -e PGOPTIONS -v "${root}:/repo:ro" --entrypoint sh $image -c "( echo 'set default_transaction_read_only = on;'; cat /repo/$rel ) | psql `$DB_URL -v ON_ERROR_STOP=1 -tA -q -f -" 2>&1
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  Clean $out | Where-Object { $_ -ne 'SET' }
  $t = @($out | Where-Object { "$_" -match '\|t$' }).Count
  $f = @($out | Where-Object { "$_" -match '\|f$' }).Count
  ''
  "result: $t true, $f false" + $(if ($code -ne 0) { " - ERROR (psql exit $code)" } else { '' })
  return
}

if ($Backup) {
  $dir = Join-Path $BackupRoot ($(if ($UseStaging) { 'staging-' } else { 'prod-' }) + (Get-Date -Format 'yyyy-MM-dd-HHmm'))
  New-Item -ItemType Directory -Force $dir | Out-Null
  "backing up ($name, read-only) into $dir"
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $out = docker run --rm -e DB_URL -e PGOPTIONS -v "${dir}:/backup" --entrypoint sh $image -c 'pg_dump $DB_URL -Fc -f /backup/full.dump && pg_restore --schema-only -f /backup/schema.sql /backup/full.dump && pg_restore --data-only -f /backup/data.sql /backup/full.dump' 2>&1
  $code = $LASTEXITCODE; $ErrorActionPreference = $prev
  Clean $out
  if ($code -ne 0) { throw "backup failed (exit $code)" }
  Get-ChildItem $dir | ForEach-Object { '{0,-12} {1,14:N0} bytes' -f $_.Name, $_.Length }
  "done: $dir"
  return
}

'Use -Backup or -Check <file>. See the top of this file.'
