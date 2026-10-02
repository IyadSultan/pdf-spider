"""Builds the saved-PDF blob name: username, date, and title."""
import re
from pathlib import Path


def safe_part(value, limit):
    """Turn a name into letters, numbers, and hyphens so it is safe as a file name."""
    text = re.sub(r"[^\w\-]+", "-", value or "", flags=re.UNICODE)
    text = re.sub(r"-{2,}", "-", text).strip("-_")
    return (text or "paper")[:limit]


def build_stored_name(username, when, title):
    day = when.strftime("%Y-%m-%d")
    return f"{safe_part(username, 40)}_{day}_{safe_part(title, 80)}.pdf"


def unique_stored_name(user, when, title):
    """Add -2, -3, and so on when this user already saved the same name today."""
    from .models import SavedPaper

    base = build_stored_name(user.username, when, title)
    name = base
    number = 2
    while SavedPaper.objects.filter(user=user, stored_name=name).exists():
        name = f"{base[:-4]}-{number}.pdf"
        number += 1
    return name


def pdf_title(uploaded, fallback_name):
    """Read the title stored inside the PDF. If it has none, use the file name."""
    fallback = Path(fallback_name or "paper.pdf").stem or "paper"
    try:
        from pypdf import PdfReader

        reader = PdfReader(uploaded)
        meta = reader.metadata
        title = ""
        if meta is not None and meta.title:
            title = str(meta.title).strip()
        uploaded.seek(0)
        return title or fallback
    except Exception as exc:
        print(f"[spider.storage.pdf_title] Could not read the PDF title: {exc}")
        try:
            uploaded.seek(0)
        except Exception as seek_exc:
            print(f"[spider.storage.pdf_title] Could not rewind the upload: {seek_exc}")
        return fallback
