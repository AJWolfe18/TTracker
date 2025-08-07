@echo off
echo Starting TrumpyTracker Local Server...
echo.
echo Open your browser and go to: http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.
cd public
npx http-server . -p 8000
pause
