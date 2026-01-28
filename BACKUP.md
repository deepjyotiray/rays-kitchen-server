# Backup Guide (Kitchen Server)

Code backup
- Script: `scripts/backup-code.sh`
- Assumes this folder is a git repo with a remote (default `origin`).
- Optional env: `CODE_REMOTE`, `CODE_BRANCH`, `CODE_MESSAGE`.
- Usage:
  ```bash
  chmod +x scripts/backup-code.sh
  ./scripts/backup-code.sh
  ```

Data backup
- This project does not store the SQLite orders DB. Use the backend repo (`ray-orders-backend`) for DB/menu backups with its `scripts/backup-data-to-github.sh`.
- Example cron for backend data (runs from backend folder):
  ```
  30 1 * * * cd /Users/deepjyotiray/Documents/FoodWebsite/ray-orders-backend && DATA_REPO=your/repo GITHUB_TOKEN=yourtoken ./scripts/backup-data-to-github.sh >> /tmp/ray-backup.log 2>&1
  ```

Tip: Configure your git remote with a token-based URL or credential helper to allow non-interactive pushes for scheduled backups.
