"""
Keeps each person's search count, saved PDFs, and the passages they found.

A saved PDF is stored as a file blob. Its name is built from the username, the date,
and the PDF title, for example ada_2026-10-02_Garden-webs.pdf.
"""
from django.conf import settings
from django.contrib.auth.models import User
from django.db import models


def paper_blob_path(instance, filename):
    """Store the PDF blob under the user's folder, using the prepared file name."""
    return f"papers/{instance.user_id}/{instance.stored_name}"


class Usage(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="usage")
    use_count = models.PositiveIntegerField(default=0, db_index=True)
    locked = models.BooleanField(default=False, db_index=True)
    locked_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "search allowance"
        verbose_name_plural = "search allowances"

    def __str__(self):
        state = "locked" if self.locked else "open"
        return f"{self.user.username}: {self.use_count}/{settings.MAX_USES} ({state})"

    @property
    def uses_left(self):
        return max(0, settings.MAX_USES - self.use_count)


class SavedPaper(models.Model):
    """One uploaded PDF. The file itself is the blob; stored_name is the blob's name."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="papers")
    title = models.CharField(max_length=200)
    original_filename = models.CharField(max_length=200, blank=True)
    stored_name = models.CharField(max_length=255)
    file = models.FileField(upload_to=paper_blob_path)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["user", "stored_name"], name="unique_paper_blob_name"),
        ]
        indexes = [models.Index(fields=["user", "created_at"])]

    def __str__(self):
        return self.stored_name


class SavedHighlight(models.Model):
    """A question and the passage that was highlighted for one saved PDF."""

    paper = models.ForeignKey(SavedPaper, on_delete=models.CASCADE, related_name="highlights")
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="highlights")
    question = models.CharField(max_length=500)
    quote = models.TextField()
    why = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["paper", "created_at"]),
            models.Index(fields=["user", "created_at"]),
        ]

    def __str__(self):
        return f"{self.paper.stored_name}: {self.question[:40]}"


class SearchLog(models.Model):
    """One row per search. This is the audit trail for the 10-use limit."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="searches")
    mode = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "created_at"])]

    def __str__(self):
        return f"{self.user.username} {self.mode} at {self.created_at:%Y-%m-%d %H:%M}"
