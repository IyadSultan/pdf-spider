#!/bin/sh
# Starts the Paper spider site. Replit runs this file when you press Run.
set -e
cd "$(dirname "$0")"

python manage.py migrate --noinput
python manage.py collectstatic --noinput

# One worker is enough for SQLite. Claude can take about a minute, so the timeout is long.
exec gunicorn config.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers 1 \
  --threads 4 \
  --timeout 120
