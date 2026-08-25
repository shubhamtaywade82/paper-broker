#!/usr/bin/env bash
set -euo pipefail

DB_FILE="${1:-data/paper.sqlite3}"
BACKUP_DIR="${2:-data/backups}"

mkdir -p "$BACKUP_DIR"

if [ -f "$DB_FILE" ]; then
  BACKUP_PATH="$BACKUP_DIR/paper-$(date +%F-%H%M%S).sqlite3"
  sqlite3 "$DB_FILE" ".backup '$BACKUP_PATH'"
  echo "Backup successfully created at $BACKUP_PATH"
  find "$BACKUP_DIR" -name 'paper-*.sqlite3' -mtime +14 -delete
else
  echo "Database file $DB_FILE does not exist. Skipping backup."
fi
