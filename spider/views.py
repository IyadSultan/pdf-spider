"""Pages and the search endpoint. The 10-use lock is enforced here, not in the browser."""
import json

from django.conf import settings
from django.contrib.auth import login
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.db import transaction
from django.db.models import Prefetch
from django.http import FileResponse, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from .forms import RegisterForm
from .models import SavedHighlight, SavedPaper, SearchLog, Usage
from .services import AskError, ask_claude, clean_images, image_prompt, text_prompt
from .storage import pdf_title, unique_stored_name


class OutOfUses(Exception):
    """Raised when this account has already used all of its searches."""


class SpiderLogin(LoginView):
    template_name = "spider/login.html"
    redirect_authenticated_user = True

    def get_form(self, form_class=None):
        form = super().get_form(form_class)
        try:
            for field in form.fields.values():
                field.widget.attrs["class"] = "form-control"
            form.fields["username"].widget.attrs["autocomplete"] = "username"
            form.fields["password"].widget.attrs["autocomplete"] = "current-password"
        except Exception as exc:
            print(f"[spider.views.SpiderLogin.get_form] Could not style the login form: {exc}")
        return form


def register(request):
    if request.user.is_authenticated:
        return redirect("app")
    form = RegisterForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            user = form.save()
            login(request, user)
        except Exception as exc:
            print(f"[spider.views.register] Could not create the account: {exc}")
            form.add_error(None, "The account could not be created. Try a different username.")
        else:
            return redirect("app")
    return render(request, "spider/register.html", {"form": form, "max_uses": settings.MAX_USES})


def _usage_for(user):
    usage, _created = Usage.objects.get_or_create(user=user)
    return usage


def account_is_unlimited(user):
    """The site owner keeps searching after other accounts have used their 10 searches."""
    names = {name.lower() for name in getattr(settings, "UNLIMITED_USERNAMES", [])}
    return user.username.lower() in names


def consume_use(user, mode):
    """
    Count one search and lock the account when it reaches the limit.

    The database row is locked for this step so two clicks at once cannot sneak past 10.
    An unlimited account is counted, but it is never locked.
    """
    _usage_for(user)
    unlimited = account_is_unlimited(user)
    try:
        with transaction.atomic():
            usage = Usage.objects.select_for_update().get(user=user)
            blocked = (not unlimited) and (usage.locked or usage.use_count >= settings.MAX_USES)
            if blocked:
                # Save the lock before leaving this block. Raising inside the block would undo the save.
                usage.locked = True
                if usage.locked_at is None:
                    usage.locked_at = timezone.now()
                usage.save(update_fields=["locked", "locked_at", "updated_at"])
            else:
                usage.use_count += 1
                if unlimited:
                    usage.locked = False
                    usage.locked_at = None
                elif usage.use_count >= settings.MAX_USES:
                    usage.locked = True
                    usage.locked_at = timezone.now()
                usage.save(update_fields=["use_count", "locked", "locked_at", "updated_at"])
                SearchLog.objects.create(user=user, mode=mode)
    except Exception as exc:
        print(f"[spider.views.consume_use] Could not record the search: {exc}")
        raise
    if blocked:
        raise OutOfUses()
    return usage


def _locked_payload(usage):
    return {
        "ok": False,
        "locked": True,
        "uses_used": usage.use_count,
        "uses_left": 0,
        "max_uses": settings.MAX_USES,
        "code": "locked",
        "message": f"This account is locked. You have used all {settings.MAX_USES} searches.",
    }


def _open_paper(user, raw_id):
    if raw_id is None or not str(raw_id).isdigit():
        return None
    return SavedPaper.objects.filter(user=user, pk=int(raw_id)).first()


@login_required
@ensure_csrf_cookie
def app_page(request):
    usage = _usage_for(request.user)
    unlimited = account_is_unlimited(request.user)
    context = {
        "usage": usage,
        "max_uses": settings.MAX_USES,
        "uses_left": usage.uses_left,
        "unlimited": unlimited,
        "claude_ready": bool(settings.ANTHROPIC_API_KEY),
        "open_paper": _open_paper(request.user, request.GET.get("paper")),
    }
    if not unlimited and (usage.locked or usage.use_count >= settings.MAX_USES):
        return render(request, "spider/locked.html", context)
    return render(request, "spider/app.html", context)


@login_required
def history(request):
    """List this person's saved PDFs, with each question and highlighted passage."""
    highlights = SavedHighlight.objects.order_by("created_at")
    papers = (
        SavedPaper.objects.filter(user=request.user)
        .prefetch_related(Prefetch("highlights", queryset=highlights))
    )
    return render(request, "spider/history.html", {"papers": papers, "max_uses": settings.MAX_USES})


@login_required
@require_POST
def save_paper(request):
    """Save the uploaded PDF as a blob named username_date_title.pdf."""
    upload = request.FILES.get("file")
    if upload is None:
        return JsonResponse({"ok": False, "message": "Choose a PDF first."}, status=400)
    if upload.size > settings.MAX_PDF_BYTES:
        return JsonResponse({"ok": False, "message": "That PDF is larger than 30 MB."}, status=400)
    original = upload.name or "paper.pdf"
    if not original.lower().endswith(".pdf"):
        return JsonResponse({"ok": False, "message": "Only a PDF can be saved."}, status=400)
    try:
        head = upload.read(5)
        upload.seek(0)
    except Exception as exc:
        print(f"[spider.views.save_paper] Could not read the upload: {exc}")
        return JsonResponse({"ok": False, "message": "That PDF could not be read."}, status=400)
    if head != b"%PDF-":
        return JsonResponse({"ok": False, "message": "That file is not a PDF."}, status=400)
    title = pdf_title(upload, original)
    try:
        stored = unique_stored_name(request.user, timezone.localtime(), title)
        paper = SavedPaper(
            user=request.user,
            title=title[:200],
            original_filename=original[:200],
            stored_name=stored,
        )
        paper.file.save(stored, upload, save=False)
        paper.save()
    except Exception as exc:
        print(f"[spider.views.save_paper] Could not store the PDF: {exc}")
        return JsonResponse({"ok": False, "message": "The PDF could not be saved."}, status=500)
    return JsonResponse(
        {"ok": True, "id": paper.id, "title": paper.title, "stored_name": paper.stored_name}
    )


@login_required
def paper_file(request, pk):
    """Send the saved PDF back to its owner only."""
    paper = get_object_or_404(SavedPaper, pk=pk, user=request.user)
    try:
        handle = paper.file.open("rb")
    except Exception as exc:
        print(f"[spider.views.paper_file] Could not open the saved PDF: {exc}")
        return JsonResponse({"ok": False, "message": "That PDF could not be opened."}, status=404)
    response = FileResponse(handle, content_type="application/pdf")
    response["Content-Disposition"] = f'inline; filename="{paper.stored_name}"'
    return response


@login_required
def paper_detail(request, pk):
    paper = get_object_or_404(
        SavedPaper.objects.prefetch_related("highlights"),
        pk=pk,
        user=request.user,
    )
    return JsonResponse(
        {
            "ok": True,
            "id": paper.id,
            "title": paper.title,
            "stored_name": paper.stored_name,
            "highlights": [
                {"question": item.question, "quote": item.quote, "why": item.why}
                for item in paper.highlights.all()
            ],
        }
    )


@login_required
@require_POST
def save_highlight(request):
    """Store the question and the passage the reader just saw. This does not use a search."""
    try:
        data = _read_json(request)
    except AskError as exc:
        return JsonResponse({"ok": False, "message": exc.message}, status=400)
    paper = get_object_or_404(SavedPaper, pk=data.get("paper_id"), user=request.user)
    question = data.get("question") if isinstance(data.get("question"), str) else ""
    quote = data.get("quote") if isinstance(data.get("quote"), str) else ""
    why = data.get("why") if isinstance(data.get("why"), str) else ""
    quote = quote.strip()[:2000]
    if len(quote) < 8:
        return JsonResponse({"ok": False, "message": "There is no passage to save."}, status=400)
    try:
        highlight = SavedHighlight.objects.create(
            paper=paper,
            user=request.user,
            question=(question.strip() or "Find the most important finding in this paper")[:500],
            quote=quote,
            why=why.strip()[:500],
        )
    except Exception as exc:
        print(f"[spider.views.save_highlight] Could not save the highlight: {exc}")
        return JsonResponse({"ok": False, "message": "The highlight could not be saved."}, status=500)
    return JsonResponse({"ok": True, "id": highlight.id})


def _read_json(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"[spider.views._read_json] Bad JSON: {exc}")
        raise AskError("bad_request", "That request could not be read.") from exc
    if not isinstance(data, dict):
        raise AskError("bad_request", "That request could not be read.")
    return data


def _question(data):
    question = data.get("question") or ""
    if not isinstance(question, str):
        raise AskError("bad_request", "The question was not text.")
    question = question.strip() or "Find the most important finding in this paper"
    if len(question) > 500:
        raise AskError("bad_request", "Ask in 500 characters or fewer.")
    return question


@require_POST
def api_ask(request):
    if not request.user.is_authenticated:
        return JsonResponse(
            {"ok": False, "code": "login", "message": "Please sign in."},
            status=401,
        )
    try:
        data = _read_json(request)
        mode = data.get("mode")
        if mode not in {"text", "image"}:
            raise AskError("bad_request", "Choose a PDF or an image first.")
        question = _question(data)
        exclude_quotes = data.get("exclude_quotes") if isinstance(data.get("exclude_quotes"), list) else []
        images = None
        document_text = ""
        if mode == "text":
            document_text = data.get("document_text") or ""
            if not isinstance(document_text, str) or len(document_text.split()) < 8:
                raise AskError("bad_request", "This document does not have enough text to search.")
            document_text = document_text[:110000]
        else:
            if not settings.ANTHROPIC_API_KEY:
                raise AskError(
                    "not_configured",
                    "This file has no selectable text. Reading it as a picture needs a Claude API key on the server.",
                )
            images = clean_images(data.get("images"))
        usage = consume_use(request.user, mode)
    except OutOfUses:
        usage = _usage_for(request.user)
        return JsonResponse(_locked_payload(usage), status=403)
    except AskError as exc:
        status = 400
        return JsonResponse(
            {"ok": False, "code": exc.code, "message": exc.message},
            status=status,
        )
    except Exception as exc:
        print(f"[spider.views.api_ask] Search setup failed: {type(exc).__name__}: {exc}")
        return JsonResponse(
            {"ok": False, "code": "failed", "message": "The search could not be started."},
            status=500,
        )

    try:
        if mode == "text":
            answer, claude_error = ask_claude(text_prompt(question, document_text, exclude_quotes))
        else:
            answer, claude_error = ask_claude(
                image_prompt(question, len(images), exclude_quotes),
                images=images,
            )
    except Exception as exc:
        print(f"[spider.views.api_ask] Search failed after it was counted: {exc}")
        answer, claude_error = None, "failed"

    return JsonResponse(
        {
            "ok": True,
            "locked": False if account_is_unlimited(request.user) else usage.locked,
            "unlimited": account_is_unlimited(request.user),
            "uses_used": usage.use_count,
            "uses_left": usage.uses_left,
            "max_uses": settings.MAX_USES,
            "answer": answer,
            "claude_error": claude_error,
            "message": "This was your last search. The account is now locked." if usage.locked else "",
        }
    )


def page_not_found(request, exception):
    return render(request, "404.html", status=404)


def server_error(request):
    return render(request, "500.html", status=500)
