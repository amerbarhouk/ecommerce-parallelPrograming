# ============================================================
# start-poc-capacity.ps1 - Production-grade start script
# ============================================================
#
# Difference from start-poc.ps1:
#   - Uses proxy-capacity.cjs (with capacity control) instead of proxy.cjs
#   - Configurable number of PHP instances (default 5)
#   - Configurable number of queue workers (default 2)
#   - Configurable max concurrent per backend
#   - Shows capacity summary on startup
#
# Usage:
#   .\start-poc-capacity.ps1                          # defaults
#   .\start-poc-capacity.ps1 -Instances 7 -Workers 3 # custom
#   .\start-poc-capacity.ps1 -MaxConcurrent 2        # 2 req per backend
# ============================================================

param(
    [int]$Instances = 5,
    [int]$Workers = 2,
    [int]$MaxConcurrent = 1,
    [int]$QueueSize = 500
)

$project = "C:\xampp\htdocs\ecommerce-parallelPrograming"
Set-Location $project

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Starting E-commerce with Capacity Control" -ForegroundColor Cyan
Write-Host "  Requirement #2: Resource Management & Capacity Control" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PHP Instances:        $Instances" -ForegroundColor Gray
Write-Host "  Queue Workers:        $Workers" -ForegroundColor Gray
Write-Host "  Max Concurrent/Backend: $MaxConcurrent" -ForegroundColor Gray
Write-Host "  Max Queue Size:       $QueueSize" -ForegroundColor Gray
Write-Host "  Total Capacity:       $($Instances * $MaxConcurrent) concurrent requests" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Kill any existing processes
Write-Host "[Cleanup] Stopping existing processes..." -ForegroundColor Yellow
Get-Process php -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Clear caches
Write-Host "[Cleanup] Clearing Laravel caches..." -ForegroundColor Yellow
php artisan route:clear 2>$null
php artisan config:clear 2>$null
php artisan cache:clear 2>$null

# Start PHP instances
$basePort = 8001
for ($i = 0; $i -lt $Instances; $i++) {
    $id = $i + 1
    $port = $basePort + $i
    Write-Host "  Starting backend $id on port $port..." -ForegroundColor Gray
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","`$env:SERVER_ID='$id'; php artisan serve --host=127.0.0.1 --port=$port`"" -WorkingDirectory $project
    Start-Sleep -Milliseconds 300
}

Start-Sleep -Seconds 2

# Start queue workers
for ($i = 0; $i -lt $Workers; $i++) {
    Write-Host "  Starting queue worker $($i + 1)..." -ForegroundColor Gray
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","php artisan queue:work --sleep=3 --tries=3 --max-time=3600`"" -WorkingDirectory $project
    Start-Sleep -Milliseconds 300
}

Start-Sleep -Seconds 2

# Start proxy with capacity control
Write-Host "  Starting Load Balancer with Capacity Control..." -ForegroundColor Gray
$env:MAX_CONCURRENT_PER_BACKEND = $MaxConcurrent
$env:MAX_QUEUE_SIZE = $QueueSize
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","`$env:MAX_CONCURRENT_PER_BACKEND='$MaxConcurrent'; `$env:MAX_QUEUE_SIZE='$QueueSize'; node proxy-capacity.cjs`"" -WorkingDirectory $project

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  All processes started!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Wait 10 seconds for all services to be ready." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Endpoints:" -ForegroundColor Cyan
Write-Host "    http://127.0.0.1:8080/whoami           - Backend identity" -ForegroundColor Gray
Write-Host "    http://127.0.0.1:8080/proxy-stats      - Capacity monitoring" -ForegroundColor Gray
Write-Host "    http://127.0.0.1:8080/proxy-health     - Health check" -ForegroundColor Gray
Write-Host "    http://127.0.0.1:8080/capacity/overview - Full capacity snapshot" -ForegroundColor Gray
Write-Host ""
Write-Host "  Capacity summary:" -ForegroundColor Cyan
Write-Host "    Max concurrent: $($Instances * $MaxConcurrent) ($Instances backends x $MaxConcurrent per backend)" -ForegroundColor Yellow
Write-Host "    Queue size:     $QueueSize requests (waiting room)" -ForegroundColor Yellow
Write-Host "    Total capacity: $($Instances * $MaxConcurrent + $QueueSize) requests max" -ForegroundColor Yellow
Write-Host ""
Write-Host "  When capacity exceeded:" -ForegroundColor Cyan
Write-Host "    - Requests wait in queue (up to $QueueSize)" -ForegroundColor Gray
Write-Host "    - Queue full -> 503 Service Unavailable + Retry-After header" -ForegroundColor Gray
Write-Host "    - System stays stable, no crashes" -ForegroundColor Green
Write-Host ""
