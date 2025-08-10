@echo off
echo ==================================
echo STARTING LOCAL TEST SERVER
echo ==================================
echo.
echo This will start a local server for testing the Supabase dashboard
echo.
echo After starting, open your browser to:
echo http://localhost:8000/index-supabase.html
echo.
echo Press Ctrl+C to stop the server
echo.

cd public
python -m http.server 8000

echo.
echo Server stopped.
pause