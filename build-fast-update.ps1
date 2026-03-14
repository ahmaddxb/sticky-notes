# Fast Update Script for My Sticky Notes - OPTIMIZED
$StartTime = Get-Date

$StagingArea = "$env:TEMP\sticky-notes-build"

# 1. Prepare clean staging area
if (Test-Path $StagingArea) { Remove-Item -Path $StagingArea -Recurse -Force }
New-Item -ItemType Directory -Path $StagingArea -Force > $null

# 2. Copy all files EXCEPT node_modules, dist, backup, updates, and ps1/log/txt files
Get-ChildItem -Path "." -Exclude "node_modules", "dist", "backup", "sync-server", "extracted-asar", "extracted-desktop-asar", "*.ps1", "*.log", "*.txt", "dist_unpacked" | Copy-Item -Destination $StagingArea -Recurse -Force

# 3. Publish to the local sync-server updates folder
$PackageJson = Get-Content "package.json" | ConvertFrom-Json
$NewVersion = $PackageJson.version
$ServerUpdatePath = "z:\my-sticky-notes\sync-server\updates\update.asar"
$VersionFile = "z:\my-sticky-notes\sync-server\updates\version.json"

Write-Host "Packaging version $NewVersion..." -ForegroundColor Cyan
npx asar pack $StagingArea $ServerUpdatePath

$VersionJson = @{
    version = $NewVersion
    asarUrl = "http://10.10.3.160:3001/update/update.asar"
} | ConvertTo-Json
Set-Content -Path $VersionFile -Value $VersionJson

Write-Host "Published version $NewVersion to local sync-server updates folder." -ForegroundColor Gray

# 4. Cleanup
Remove-Item -Path $StagingArea -Recurse -Force

$EndTime = Get-Date
$Duration = $EndTime - $StartTime
Write-Host "Update Complete!" -ForegroundColor Green
Write-Host "Real Time: $($Duration.Minutes)m $($Duration.Seconds)s (Should be < 2s now)" -ForegroundColor Yellow

if ($args.Contains("-run")) {
    Start-Process "$([Environment]::GetFolderPath('Desktop'))\My Sticky Notes\My Sticky Notes.exe"
} else {
    pause
}
