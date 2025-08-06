import os
import shutil

def move_daily_files():
    # Get current directory
    source_dir = os.getcwd()
    data_dir = os.path.join(source_dir, 'data')
    
    # Ensure data directory exists
    os.makedirs(data_dir, exist_ok=True)
    
    # Get all files in current directory
    files = os.listdir(source_dir)
    
    # Filter for daily files
    daily_files = [
        f for f in files 
        if (f.startswith('real-news-tracker-') or 
            f.startswith('tracker-data-') or
            f.startswith('test-data-') or
            f.startswith('test-news-tracker-')) and f.endswith('.json')
    ]
    
    print(f"Found {len(daily_files)} daily files to move:")
    
    moved_count = 0
    failed_count = 0
    
    for file in daily_files:
        try:
            source_path = os.path.join(source_dir, file)
            dest_path = os.path.join(data_dir, file)
            shutil.move(source_path, dest_path)
            print(f"  ✓ Moved: {file}")
            moved_count += 1
        except Exception as e:
            print(f"  ✗ Failed to move {file}: {e}")
            failed_count += 1
    
    print(f"\nResults:")
    print(f"  ✓ Successfully moved: {moved_count} files")
    print(f"  ✗ Failed to move: {failed_count} files")
    
    if moved_count > 0:
        print(f"\n🎉 Daily files are now organized in the 'data' folder!")

if __name__ == "__main__":
    move_daily_files()
