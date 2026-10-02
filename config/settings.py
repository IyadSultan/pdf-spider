"""
Site settings for Paper spider.

Secrets come from the environment (Replit Secrets, or a local .env file).
Nothing secret is written in this file.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv():
    """Read a local .env file. Replit Secrets are already in the environment, so those win."""
    path = BASE_DIR / ".env"
    if not path.exists():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        print(f"[config.settings] Could not read .env: {exc}")
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _flag(name, default="false"):
    return os.environ.get(name, default).strip().lower() in {"1", "true", "yes", "on"}


SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    "dev-only-not-for-a-public-repl-set-DJANGO_SECRET_KEY",
)

ON_REPLIT = bool(os.environ.get("REPLIT_DEV_DOMAIN") or os.environ.get("REPL_ID"))

# On Replit this stays off unless you set DJANGO_DEBUG=true. On your own computer it stays on so pages and error messages work without extra steps.
DEBUG = _flag("DJANGO_DEBUG", "false" if ON_REPLIT else "true")

_default_hosts = "localhost,127.0.0.1,.replit.dev,.replit.app,.repl.co"
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", _default_hosts).split(",")
    if host.strip()
]

# Browsers send a CSRF token with each search. These are the https origins allowed to do that.
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]
for _env_name in ("REPLIT_DEV_DOMAIN", "REPLIT_DOMAINS"):
    for _host in os.environ.get(_env_name, "").split(","):
        _host = _host.strip()
        if _host:
            CSRF_TRUSTED_ORIGINS.append(f"https://{_host}")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "spider.apps.SpiderConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Amman"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "app"
LOGOUT_REDIRECT_URL = "login"

# Replit sits behind a proxy that terminates HTTPS.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True
BEHIND_HTTPS = _flag("DJANGO_BEHIND_HTTPS", "true" if ON_REPLIT else "false")
SESSION_COOKIE_SECURE = BEHIND_HTTPS
CSRF_COOKIE_SECURE = BEHIND_HTTPS
CSRF_COOKIE_HTTPONLY = True
SESSION_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Page images and saved PDFs can be larger than Django's usual 2.5 MB limit.
DATA_UPLOAD_MAX_MEMORY_SIZE = 30 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 30 * 1024 * 1024
MAX_PDF_BYTES = 30 * 1024 * 1024

# Each account may press Find this many times. The next attempt is refused.
MAX_USES = 10
# These usernames never lock. Everyone else still stops after MAX_USES searches.
UNLIMITED_USERNAMES = ["isultan"]
MAX_IMAGE_PAGES = 4

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5").strip()

# Mail is not sent by this app. The address is here so Django has a from-address if mail is added later.
DEFAULT_FROM_EMAIL = "iyad.y.sultan@gmail.com"
SERVER_EMAIL = "iyad.y.sultan@gmail.com"
ADMINS = [("Iyad Sultan", "iyad.y.sultan@gmail.com")]
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
