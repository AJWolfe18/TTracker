# RSS Pipeline Status Check for PowerShell
# Run this to see what's working in the RSS system

Write-Host "🔍 RSS PIPELINE STATUS CHECK" -ForegroundColor Cyan
Write-Host ("=" * 80) -ForegroundColor Gray
Write-Host ""

# Set environment to TEST
$env:NODE_ENV = "test"

# Change to project directory
Set-Location "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠️  node_modules not found. Running npm install..." -ForegroundColor Yellow
    npm install
}

# Run the status check script
Write-Host "Running pipeline status check..." -ForegroundColor Green
Write-Host ""

# Execute the Node.js script
& node scripts\check-rss-pipeline-status.js

# Check if it worked
if ($LASTEXITCODE -ne 0) {
    Write-Host "`n⚠️  Error running script. Checking environment..." -ForegroundColor Yellow
    Write-Host "NODE_ENV = $env:NODE_ENV" -ForegroundColor Gray
    Write-Host "Current Directory = $(Get-Location)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Try running manually:" -ForegroundColor Yellow
    Write-Host '  $env:NODE_ENV = "test"' -ForegroundColor White
    Write-Host "  node scripts\check-rss-pipeline-status.js" -ForegroundColor White
}

Write-Host "`n" -NoNewline
Write-Host ("=" * 80) -ForegroundColor Gray
Write-Host "📊 Quick SQL Checks (run these in Supabase):" -ForegroundColor Cyan
Write-Host ""
Write-Host "-- Check articles count" -ForegroundColor Green
Write-Host "SELECT COUNT(*) FROM articles;" -ForegroundColor White
Write-Host ""
Write-Host "-- Check recent articles" -ForegroundColor Green  
Write-Host "SELECT title, source_name, created_at" -ForegroundColor White
Write-Host "FROM articles" -ForegroundColor White
Write-Host "ORDER BY created_at DESC" -ForegroundColor White
Write-Host "LIMIT 5;" -ForegroundColor White
Write-Host ""
Write-Host "-- Check if any stories exist" -ForegroundColor Green
Write-Host "SELECT COUNT(*) FROM stories;" -ForegroundColor White
Write-Host ""
Write-Host "Done! Press any key to exit..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
