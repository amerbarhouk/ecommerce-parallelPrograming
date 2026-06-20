# ============================================================
# Stress Test Runner - Requirement #9
# Runs all stress test scenarios and generates a report
# ============================================================
#
# USAGE:
#   .\stress-test.ps1                          # Default: 100 concurrent, 30s each
#   .\stress-test.ps1 -Concurrent 200          # 200 concurrent users
#   .\stress-test.ps1 -Duration 60             # 60 seconds per scenario
#   .\stress-test.ps1 -Scenario acid           # Run single scenario
#   .\stress-test.ps1 -Concurrent 150 -Duration 45
#
# REQUIREMENTS:
#   - Proxy + Laravel servers running (.\start-poc.ps1)
#   - Redis (Memurai) running on 127.0.0.1:6379
#   - MySQL/DB accessible
#   - Node.js installed
# ============================================================

param(
    [int]$Concurrent = 100,
    [int]$Duration = 30,
    [string]$Scenario = "all"
)

$ErrorActionPreference = "Continue"
$project = $PSScriptRoot
Set-Location $project

# ============================================================
# HEADER
# ============================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  STRESS TEST RUNNER - Requirement #9" -ForegroundColor Cyan
Write-Host "  Stability under concurrent load (>= 100 users)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Concurrent users : $Concurrent" -ForegroundColor Gray
Write-Host "  Duration         : $Duration seconds per scenario" -ForegroundColor Gray
Write-Host "  Scenario         : $Scenario" -ForegroundColor Gray
Write-Host "  Target           : http://127.0.0.1:8080" -ForegroundColor Gray
Write-Host "  Start time       : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host ""

# ============================================================
# PRE-FLIGHT CHECKS
# ============================================================
Write-Host "[Pre-flight] Checking system readiness..." -ForegroundColor Yellow

# Check proxy
$proxyOk = $false
try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:8080/whoami" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "  [OK] Proxy is responding (port 8080)" -ForegroundColor Green
        $proxyOk = $true
    }
} catch {
    Write-Host "  [FAIL] Proxy not responding on port 8080" -ForegroundColor Red
    Write-Host "         Run .\start-poc.ps1 first" -ForegroundColor Yellow
    exit 1
}

# Check Redis
$redisOk = $false
try {
    $redis = Get-Process -Name "redis-server","memurai" -ErrorAction SilentlyContinue
    if ($redis) {
        Write-Host "  [OK] Redis/Memurai is running (PID: $($redis.Id -join ', '))" -ForegroundColor Green
        $redisOk = $true
    } else {
        Write-Host "  [WARN] Redis process not detected (may still be accessible)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [WARN] Could not check Redis process" -ForegroundColor Yellow
}

# Check backend servers via /whoami
try {
    $ports = @()
    for ($i = 0; $i -lt 5; $i++) {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:8080/whoami" -UseBasicParsing -TimeoutSec 3
        $json = $r.Content | ConvertFrom-Json
        $ports += $json.port
    }
    $uniquePorts = $ports | Sort-Object -Unique
    Write-Host "  [OK] Load Balancer distributing across $($uniquePorts.Count) backend(s): $($uniquePorts -join ', ')" -ForegroundColor Green
    if ($uniquePorts.Count -lt 2) {
        Write-Host "  [WARN] Only 1 backend detected - stress test may not show full distribution" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  [WARN] Could not verify backend distribution" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  STARTING STRESS TEST" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================
# RUN STRESS TEST
# ============================================================
$startTime = Get-Date

if ($Scenario -eq "all") {
    # Run all scenarios
    node stress-test.cjs all $Concurrent $Duration
} else {
    # Run single scenario
    node stress-test.cjs $Scenario $Concurrent $Duration
}

$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

# ============================================================
# FINAL REPORT
# ============================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  STRESS TEST COMPLETED" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Start: $startTime" -ForegroundColor Gray
Write-Host "  End:   $endTime" -ForegroundColor Gray
Write-Host "  Total duration: $([math]::Round($duration, 1)) seconds" -ForegroundColor Gray
Write-Host ""

# Check if report file was generated
$reportFile = Join-Path $project "stress-test-report.json"
if (Test-Path $reportFile) {
    Write-Host "  [OK] JSON report saved to: $reportFile" -ForegroundColor Green
    $reportSize = (Get-Item $reportFile).Length
    Write-Host "       Size: $reportSize bytes" -ForegroundColor Gray
}

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Review the results above" -ForegroundColor Gray
Write-Host "  2. Fill in the STRESS_TEST_REPORT.md template with the metrics" -ForegroundColor Gray
Write-Host "  3. For interview: prepare a summary of stability + data integrity results" -ForegroundColor Gray
Write-Host ""

# ============================================================
# INTERPRETATION HINTS
# ============================================================
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  HOW TO INTERPRET RESULTS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  STABLE (PASS):" -ForegroundColor Green
Write-Host "    - Success rate >= 95%" -ForegroundColor Gray
Write-Host "    - No HTTP 5xx errors (except intentional ACID 500 for fail_after)" -ForegroundColor Gray
Write-Host "    - p95 latency < 2000ms" -ForegroundColor Gray
Write-Host "    - All 5 backends received traffic" -ForegroundColor Gray
Write-Host ""
Write-Host "  UNSTABLE (FAIL):" -ForegroundColor Red
Write-Host "    - Success rate < 95%" -ForegroundColor Gray
Write-Host "    - Connection errors (ECONNREFUSED, ETIMEDOUT)" -ForegroundColor Gray
Write-Host "    - p99 latency > 10000ms" -ForegroundColor Gray
Write-Host "    - Only 1-2 backends received traffic (LB bottleneck)" -ForegroundColor Gray
Write-Host ""
Write-Host "  DATA INTEGRITY (for safe/acid scenarios):" -ForegroundColor Yellow
Write-Host "    - Lost updates = 0 -> PASS (locking/transaction working)" -ForegroundColor Green
Write-Host "    - Lost updates > 0 -> FAIL (investigate locking)" -ForegroundColor Red
Write-Host ""
