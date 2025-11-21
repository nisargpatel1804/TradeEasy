# TradeEasy Auto-Start Script
# This script starts both backend and frontend servers and opens the browser

Write-Host "Starting TradeEasy..." -ForegroundColor Green

# Start Backend in a new PowerShell window
Write-Host "Starting Backend Server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\Projects\TradeEasy\backend'; & 'D:\Projects\TradeEasy\backend\venv\Scripts\Activate.ps1'; python run.py"

# Wait a few seconds for backend to initialize
Write-Host "Waiting for backend to initialize..." -ForegroundColor Yellow
Start-Sleep -Seconds 5

# Start Frontend in a new PowerShell window
Write-Host "Starting Frontend Server..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd 'D:\Projects\TradeEasy\frontend'; npm run dev"

# Wait for frontend to start
Write-Host "Waiting for frontend to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Open browser
Write-Host "Opening browser at http://localhost:5173/" -ForegroundColor Green
Start-Process "http://localhost:5173/"

Write-Host "`nTradeEasy is now running!" -ForegroundColor Green
Write-Host "Backend: Running in separate window" -ForegroundColor White
Write-Host "Frontend: Running in separate window" -ForegroundColor White
Write-Host "Browser: http://localhost:5173/" -ForegroundColor White
Write-Host "`nPress any key to exit this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
