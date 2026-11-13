<#
  Pushes the project to GitHub.

  It will:
    1. run the pre-push secret audit (refuses to continue if anything leaks)
    2. create/verify the remote
    3. push the `main` branch

  The only interactive step is GitHub authentication — Git Credential Manager
  opens your browser and you sign in there.

  Usage:
    powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1
    powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -Username YOUR-USERNAME -Repo sawaari
#>
param(
  [string]$Username = '',
  [string]$Repo = 'sawaari',
  [switch]$SkipAudit
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # project root
Set-Location $root

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }

# ── 1. audit ────────────────────────────────────────────────
if (-not $SkipAudit) {
  Say 'Running the pre-push secret audit…' 'Cyan'
  & node 'scripts/audit-before-push.js'
  if ($LASTEXITCODE -ne 0) {
    Say 'Audit FAILED — refusing to push. Fix the items it lists first.' 'Red'
    exit 1
  }
  Say 'Audit passed.' 'Green'
}

# ── 2. work out the target ──────────────────────────────────
if (-not $Username) {
  $Username = Read-Host 'Your GitHub username (e.g. utkarshba)'
}
if (-not $Username) { Say 'A GitHub username is required.' 'Red'; exit 1 }

$url = "https://github.com/$Username/$Repo.git"
Say "Target repository: $url" 'Cyan'

$existing = git remote get-url origin 2>$null
if ($existing -eq $url) {
  Say "origin already points at $url" 'Green'
} elseif ($existing) {
  Say "origin currently points at $existing — updating it" 'Yellow'
  & git remote set-url origin $url
} else {
  & git remote add origin $url
  Say 'remote origin added' 'Green'
}

# ── 3. push ─────────────────────────────────────────────────
Say ''
Say 'Pushing — GitHub will ask you to sign in (browser window opens).' 'Yellow'
& git push -u origin main
$code = $LASTEXITCODE

Say ''
if ($code -eq 0) {
  Say "Pushed. Your repo: https://github.com/$Username/$Repo" 'Green'
  Say 'Next: DEPLOY.md shows how to take it live (Render / Fly / Docker).' 'Cyan'
} else {
  Say "Push failed (exit $code)." 'Red'
  Say ''
  Say 'Most common causes:' 'Yellow'
  Say '  • the repository does not exist yet — create it at https://github.com/new'
  Say '    (leave it EMPTY: do not add a README or .gitignore)'
  Say '  • sign-in was cancelled — run the command again and complete the browser login'
  Say "  • you do not own $Username/$Repo — create it under your own account"
  Say ''
  Say "Manual retry:" 'Cyan'
  Say "  git push -u origin main"
}
exit $code
