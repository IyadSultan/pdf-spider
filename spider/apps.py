from django.apps import AppConfig


class SpiderConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "spider"
    verbose_name = "Paper spider"

    def ready(self):
        # Connects the "new account gets a usage row" hook.
        from . import signals  # noqa: F401
