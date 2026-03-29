from pathlib import Path
import gzip
import shutil
import os
import sys
import traceback

SOURCE_FOLDER = Path("training_data")  # change if needed
RECURSIVE = True      # set False to only look at top-level folder
OVERWRITE = False     # set True to overwrite existing .csv files
DELETE_GZ_AFTER = False  # set True if you want to remove .csv.gz after successful conversion

if not SOURCE_FOLDER.exists():
    print(f"Error: source folder does not exist: {SOURCE_FOLDER}", file=sys.stderr)
    sys.exit(1)

pattern = "**/*.csv.gz" if RECURSIVE else "*.csv.gz"

success = 0
skipped = 0
failed = 0
failures = []

for gz_path in SOURCE_FOLDER.glob(pattern):
    # handle files like .CSV.GZ too by lowercasing suffix check (glob already matched .csv.gz)
    try:
        # determine target csv name: remove only the last suffix (.gz)
        csv_path = gz_path.with_suffix("")  # file.csv.gz -> file.csv
        if csv_path.exists() and not OVERWRITE:
            print(f"Skipping (exists): {csv_path}")
            skipped += 1
            continue

        tmp_path = csv_path.with_suffix(csv_path.suffix + ".tmp") if csv_path.suffix else Path(str(csv_path) + ".tmp")

        # stream-copy gzip -> temp file
        with gzip.open(gz_path, "rb") as f_in, open(tmp_path, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)

        # atomic rename
        os.replace(tmp_path, csv_path)

        if DELETE_GZ_AFTER:
            try:
                gz_path.unlink()
            except Exception as e:
                print(f"Warning: could not delete original {gz_path}: {e}")

        print(f"Converted: {gz_path.relative_to(SOURCE_FOLDER)} -> {csv_path.relative_to(SOURCE_FOLDER)}")
        success += 1

    except Exception as e:
        failed += 1
        failures.append((gz_path, str(e), traceback.format_exc()))
        # clean up any temp file left behind
        try:
            if 'tmp_path' in locals() and tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass
        print(f"Failed: {gz_path} -> {e}")

print("\nSummary:")
print(f"  Converted: {success}")
print(f"  Skipped  : {skipped}")
print(f"  Failed   : {failed}")

if failed:
    print("\nFailures (first 5):")
    for p, msg, tb in failures[:5]:
        print(f"- {p}: {msg}")
