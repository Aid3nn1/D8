# ================================================================
#  DYNASTY 8 - DEPLOY SCRIPT
#  Sends frontend and/or backend to the VPS.
#  key.env is never overwritten on the server, node_modules never sent.
#  Assets folder is excluded from frontend deploy (use -Global instead).
#
#  Usage:
#    .\deploy.ps1              -> deploy everything (frontend + backend)
#    .\deploy.ps1 -Frontend    -> deploy frontend only (excl. assets)
#    .\deploy.ps1 -Backend     -> deploy backend only
# ================================================================

param(
    [switch]$Frontend,
    [switch]$Backend
)

if (-not $Frontend -and -not $Backend) {
    $Frontend = $true
    $Backend = $true
}

$VpsUser = "root"
$VpsIp = "217.145.72.93"
$VpsTarget = "$VpsUser@$VpsIp"
$LocalPath = "C:\Users\arlan\Desktop\Dynasty_8 V2"
$RemoteStaging = "/root/dynasty8"
$RemoteFrontendLive = "/var/www/dynasty8"

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  DYNASTY 8 - DEPLOYMENT" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------
#  FRONTEND
# ---------------------------------------------------------------
if ($Frontend) {
    Write-Host ""
    Write-Host "[1/2] Sending frontend (excl. assets)..." -ForegroundColor Yellow

    # Create temp directory for frontend without assets
    $tempDir = "$env:TEMP\dynasty8_frontend_deploy"
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    # Copy frontend files excluding assets folder
    robocopy "$LocalPath\frontend" $tempDir /E /XD assets | Out-Null

    # Cache-busting: inject a unique build number into index.html
    $buildId = Get-Date -Format "yyyyMMddHHmmss"
    $indexPath = Join-Path $tempDir "index.html"
    (Get-Content $indexPath -Raw) -replace '__BUILD__', $buildId | Set-Content $indexPath -NoNewline
    Write-Host "  -> Build id: $buildId" -ForegroundColor DarkGray

    # Send to VPS
    scp -r $tempDir "${VpsTarget}:${RemoteStaging}/"

    

    # Send to VPS
    scp -r $tempDir "${VpsTarget}:${RemoteStaging}/"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: could not send frontend." -ForegroundColor Red
        Remove-Item $tempDir -Recurse -Force
        exit 1
    }

    Write-Host "  -> Syncing to /var/www and fixing permissions..." -ForegroundColor Yellow
    $frontendCmd = "cp -r " + $RemoteStaging + "/dynasty8_frontend_deploy/* " + $RemoteFrontendLive + "/ && chown -R www-data:www-data " + $RemoteFrontendLive
    ssh $VpsTarget $frontendCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: could not sync frontend on server." -ForegroundColor Red
        Remove-Item $tempDir -Recurse -Force
        exit 1
    }

    # Cleanup
    Remove-Item $tempDir -Recurse -Force
    ssh $VpsTarget "rm -rf ${RemoteStaging}/dynasty8_frontend_deploy"

    Write-Host "OK: frontend deployed (assets excluded)." -ForegroundColor Green
}

# ---------------------------------------------------------------
#  BACKEND
# ---------------------------------------------------------------
if ($Backend) {
    Write-Host ""
    Write-Host "[2/2] Sending backend..." -ForegroundColor Yellow

    $tempDir = "$env:TEMP\dynasty8_backend_deploy"
    if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }

    robocopy "$LocalPath\backend" $tempDir /E /XD node_modules /XF key.env | Out-Null

    scp -r $tempDir "${VpsTarget}:${RemoteStaging}/backend_new"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: could not send backend." -ForegroundColor Red
        Remove-Item $tempDir -Recurse -Force
        exit 1
    }

    Write-Host "  -> Merging files, npm install, restarting PM2..." -ForegroundColor Yellow
    $backendCmd = "rsync -a " + $RemoteStaging + "/backend_new/ " + $RemoteStaging + "/backend/ && rm -rf " + $RemoteStaging + "/backend_new && cd " + $RemoteStaging + "/backend && npm install --legacy-peer-deps && node discord/deploy-commands.js && pm2 reload dynasty8 --update-env"
    ssh $VpsTarget $backendCmd
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED: could not restart backend on server." -ForegroundColor Red
        Remove-Item $tempDir -Recurse -Force
        exit 1
    }

    # Cleanup
    Remove-Item $tempDir -Recurse -Force

    Write-Host "OK: backend deployed and restarted." -ForegroundColor Green
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Deployment finished." -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan