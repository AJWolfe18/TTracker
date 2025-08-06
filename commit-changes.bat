@echo off
echo 🚀 Committing TTracker file organization changes...
echo.

REM Add all the new and changed files
echo 📂 Adding organized files to git...
git add data/
git add daily-tracker.js
git add .

echo.
echo 📝 Committing changes...
git commit -m "📁 Organize daily tracking files

✨ Major project cleanup and organization:

🗂️ File Organization:
- Created data/ folder for all daily tracking files  
- Moved 40+ daily JSON files from root to data/ directory
- Root directory now clean and professional

💻 Code Updates:
- Updated daily-tracker.js to save files to data/ folder
- Added automatic data directory creation
- Future daily files will auto-organize in data/

📊 Files Moved:
- real-news-tracker-*.json files → data/
- tracker-data-*.json files → data/  
- test-*.json files → data/

🎯 Benefits:
- Clean project structure
- Better file organization  
- Automated file management
- Professional project layout
- Easier maintenance and navigation

No functionality changes - everything works the same, just organized!"

echo.
echo 🌐 Pushing to GitHub...
git push origin main

echo.
echo ✅ Changes committed and pushed successfully!
echo 🎉 Your organized TTracker is now live on GitHub!
pause
