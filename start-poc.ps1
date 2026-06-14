 $project = "C:\xampp\htdocs\ecommerce-parallelPrograming"
cd $project

# Start 5 app instances (each in new PowerShell window) with different SERVER_ID and ports
 $ports = 8001..8005
for ($i=0; $i -lt $ports.Count; $i++) {
  $id = $i + 1
  $port = $ports[$i]
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","`$env:SERVER_ID='$id'; php artisan serve --host=127.0.0.1 --port=$port`"" -WorkingDirectory $project
  Start-Sleep -Milliseconds 300
}

Start-Sleep -Seconds 2

# Start 2 queue workers (each in new PowerShell window)
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","php artisan queue:work --sleep=3 --tries=3" -WorkingDirectory $project
Start-Sleep -Milliseconds 300
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","php artisan queue:work --sleep=3 --tries=3" -WorkingDirectory $project

Start-Sleep -Seconds 2

# Start Node proxy (in new window)
Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit","-Command","node proxy.cjs" -WorkingDirectory $project

Write-Host "All processes started. Wait a few seconds then run `node client.cjs` to send 5 requests to LB (http://127.0.0.1:8080)."
