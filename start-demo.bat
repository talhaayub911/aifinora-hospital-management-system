@echo off
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
if "%DATABASE_URL%"=="" set DATABASE_URL=file:./dev.db
echo Applying database migrations and preparing demo data when the database is empty...
call npm run db:bootstrap:demo || exit /b 1
echo Starting AI Finora Multi-Hospital SaaS Demo...
call npm run dev
pause
