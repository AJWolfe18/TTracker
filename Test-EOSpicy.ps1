# Test EO Spicy Translations PowerShell Script
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "TESTING EO SPICY TRANSLATIONS" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Change to project directory
Set-Location "C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker"

Write-Host "Step 1: Testing database connection and environment" -ForegroundColor Yellow
Write-Host "---------------------------------------------------"
node scripts\test-eo-backfill.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Database connection test failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

Write-Host "Step 2: Test with 1 executive order" -ForegroundColor Yellow
Write-Host "---------------------------------------------------"
node scripts\backfill-executive-spicy-simple.js --limit 1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Backfill test failed!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Green
Write-Host "TEST COMPLETE - Check output above" -ForegroundColor Green
Write-Host "If successful, run full backfill with:" -ForegroundColor Green
Write-Host "node scripts\backfill-executive-spicy-simple.js --limit 500 --yes" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Green
Read-Host "Press Enter to exit"
