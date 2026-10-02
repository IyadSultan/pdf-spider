#!/usr/bin/env python
"""Starts Django commands such as migrate and runserver."""
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        print("[manage.py] Django is not installed. Run: python -m pip install -r requirements.txt")
        raise exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
