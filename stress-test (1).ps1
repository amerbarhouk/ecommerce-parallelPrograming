# ============================================================
# Stress Test Runner v2 - Requirement #9
# Uses /stress/* endpoints (no sleep) for proper stress testing
# ============================================================

param(
    [int]$Concurrent = 100,
    [int]$Duration = 30,
    [string]$Scenario = "all"
)

$project = $PSScriptRoot
Set-Location $project

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  STRESS TEST v2 - Requirement #9" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Concurrent: $Concurrent | Duration: ${Duration}s | Scenario: $Scenario" -ForegroundColor Gray
Write-Host "  Start: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# Pre-flight
Write-Host "[Pre-flight] Checking system..." -ForegroundColor Yellow
try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/stress/ping" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($r.StatusCode -eq 200) {
        Write-Host "  [OK] Proxy + /stress/ping endpoint working" -ForegroundColor Green
    }
} catch {
    Write-Host "  [FAIL] Cannot reach /stress/ping" -ForegroundColor Red
    Write-Host "         Make sure:" -ForegroundColor Yellow
    Write-Host "         1. Servers running: .\start-poc.ps1" -ForegroundColor Yellow
    Write-Host "         2. StressTestController.php added to app/Http/Controllers/" -ForegroundColor Yellow
    Write-Host "         3. Stress routes added to routes/web.php" -ForegroundColor Yellow
    exit 1
}

# Run
if ($Scenario -eq "all") {
    node stress-test.cjs all $Concurrent $Duration
} else {
    node stress-test.cjs $Scenario $Concurrent $Duration
}

Write-Host ""
Write-Host "Done. Review results above." -ForegroundColor Green
