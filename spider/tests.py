"""Checks the 10-search lock and that saved PDFs keep their questions."""
import io
import json
import tempfile

from django.contrib.auth.models import User
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .models import SavedHighlight, SavedPaper, Usage
from .services import clean_images, image_prompt, text_prompt


@override_settings(ANTHROPIC_API_KEY="")
class SearchLimitTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("ada", password="safe-password-123")
        self.payload = {
            "mode": "text",
            "question": "What is the main finding?",
            "document_text": (
                "Webs rebuilt after a night of large prey carried 31 percent higher radial tension "
                "than webs rebuilt after small prey."
            ),
        }

    def _ask(self):
        return self.client.post(
            reverse("api_ask"),
            data=json.dumps(self.payload),
            content_type="application/json",
        )

    def test_new_account_starts_with_ten_searches(self):
        usage = Usage.objects.get(user=self.user)
        self.assertEqual(usage.use_count, 0)
        self.assertFalse(usage.locked)
        self.assertEqual(usage.uses_left, 10)

    def test_isultan_stays_open_after_ten_searches(self):
        owner = User.objects.create_user("isultan", password="safe-password-123")
        usage = Usage.objects.get(user=owner)
        usage.use_count = 10
        usage.locked = True
        usage.save()
        self.client.login(username="isultan", password="safe-password-123")
        response = self._ask()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["locked"])
        self.assertTrue(response.json()["unlimited"])
        page = self.client.get(reverse("app"))
        self.assertContains(page, "does not run out of searches")
        usage.refresh_from_db()
        self.assertFalse(usage.locked)
        self.assertEqual(usage.use_count, 11)

    def test_search_requires_sign_in(self):
        response = self._ask()
        self.assertEqual(response.status_code, 401)

    def test_tenth_search_works_and_eleventh_is_locked(self):
        self.client.login(username="ada", password="safe-password-123")
        for number in range(1, 11):
            response = self._ask()
            self.assertEqual(response.status_code, 200, response.content)
            body = response.json()
            self.assertEqual(body["uses_used"], number)
            self.assertEqual(body["claude_error"], "not_configured")
        self.assertTrue(response.json()["locked"])
        self.assertEqual(response.json()["uses_left"], 0)

        blocked = self._ask()
        self.assertEqual(blocked.status_code, 403)
        self.assertTrue(blocked.json()["locked"])

        usage = Usage.objects.get(user=self.user)
        self.assertTrue(usage.locked)
        self.assertEqual(usage.use_count, 10)
        self.assertEqual(self.user.searches.count(), 10)

    def test_picture_search_without_a_key_does_not_count(self):
        self.client.login(username="ada", password="safe-password-123")
        response = self.client.post(
            reverse("api_ask"),
            data=json.dumps({"mode": "image", "question": "Find the result", "images": []}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "not_configured")
        self.assertEqual(Usage.objects.get(user=self.user).use_count, 0)

    def test_short_text_does_not_count(self):
        self.client.login(username="ada", password="safe-password-123")
        response = self.client.post(
            reverse("api_ask"),
            data=json.dumps({"mode": "text", "question": "Find it", "document_text": "Too short"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Usage.objects.get(user=self.user).use_count, 0)

    def test_locked_account_sees_the_locked_page(self):
        usage = Usage.objects.get(user=self.user)
        usage.use_count = 10
        usage.locked = True
        usage.save()
        self.client.login(username="ada", password="safe-password-123")
        response = self.client.get(reverse("app"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "locked")

    def test_unlock_action_resets_the_allowance(self):
        from django.contrib.admin.sites import site

        from .admin import UsageAdmin

        usage = Usage.objects.get(user=self.user)
        usage.use_count = 10
        usage.locked = True
        usage.save()
        admin_page = UsageAdmin(Usage, site)
        admin_page.unlock_users(request=None, queryset=Usage.objects.filter(pk=usage.pk))
        usage.refresh_from_db()
        self.assertFalse(usage.locked)
        self.assertEqual(usage.use_count, 0)


class PageImageTests(SimpleTestCase):
    def test_image_search_keeps_every_supplied_page(self):
        images = ["data:image/jpeg;base64,YQ==" for _ in range(12)]

        cleaned = clean_images(images)
        prompt = image_prompt("Find the result", len(cleaned))

        self.assertEqual(len(cleaned), 12)
        self.assertIn("There are 12 page images", prompt)


class PageTests(TestCase):
    def test_reader_api_routes_do_not_use_replit_api_artifact_prefix(self):
          api_paths = (
              reverse("api_ask"),
              reverse("save_paper"),
              reverse("paper_detail", args=[1]),
              reverse("paper_file", args=[1]),
              reverse("save_highlight"),
          )
          for path in api_paths:
              with self.subTest(path=path):
                  self.assertTrue(path.startswith("/paper-api/"), path)

        def test_signed_in_reader_shows_the_spider(self):
        User.objects.create_user("bea", password="safe-password-123")
        self.client.login(username="bea", password="safe-password-123")
        response = self.client.get(reverse("app"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Find it")
        self.assertContains(response, "Find more")
        self.assertContains(response, "Your papers")
        self.assertContains(response, "usesLeft: 10")

    def test_register_creates_an_allowance_and_signs_in(self):
        response = self.client.post(
            reverse("register"),
            {
                "username": "cam",
                "password1": "safe-password-123",
                "password2": "safe-password-123",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.assertTrue(Usage.objects.filter(user__username="cam", use_count=0, locked=False).exists())

    def test_home_asks_visitors_to_sign_in(self):
        response = self.client.get(reverse("app"))
        self.assertEqual(response.status_code, 302)
        self.assertIn("/accounts/login/", response.url)

    def test_register_page_explains_the_limit(self):
        response = self.client.get(reverse("register"))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "10")

    def test_unknown_page_is_a_404(self):
        response = self.client.get("/no-such-page/")
        self.assertEqual(response.status_code, 404)


def _sample_pdf(title):
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    writer.add_metadata({"/Title": title})
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


class SavedPaperTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.override = override_settings(MEDIA_ROOT=self.media.name)
        self.override.enable()
        self.user = User.objects.create_user("ada", password="safe-password-123")
        self.other = User.objects.create_user("bea", password="safe-password-123")
        self.client.login(username="ada", password="safe-password-123")

    def tearDown(self):
        self.override.disable()
        self.media.cleanup()

    def _upload(self, title="Garden webs"):
        upload = SimpleUploadedFile("notes.pdf", _sample_pdf(title), content_type="application/pdf")
        return self.client.post(reverse("save_paper"), {"file": upload})

    def test_blob_name_uses_username_date_and_title(self):
        response = self._upload()
        self.assertEqual(response.status_code, 200, response.content)
        paper = SavedPaper.objects.get(user=self.user)
        day = timezone.localdate().isoformat()
        self.assertEqual(paper.stored_name, f"ada_{day}_Garden-webs.pdf")
        self.assertTrue(paper.file.name.endswith(paper.stored_name))
        self.assertGreater(paper.file.size, 0)

    def test_second_save_on_the_same_day_gets_a_new_name(self):
        self._upload()
        self._upload()
        names = list(SavedPaper.objects.filter(user=self.user).values_list("stored_name", flat=True))
        self.assertEqual(len(names), 2)
        self.assertEqual(len(set(names)), 2)

    def test_another_person_cannot_open_the_file(self):
        self._upload()
        paper = SavedPaper.objects.get(user=self.user)
        self.client.login(username="bea", password="safe-password-123")
        response = self.client.get(reverse("paper_file", args=[paper.id]))
        self.assertEqual(response.status_code, 404)

    def test_history_shows_the_question_and_highlight(self):
        self._upload()
        paper = SavedPaper.objects.get(user=self.user)
        SavedHighlight.objects.create(
            paper=paper,
            user=self.user,
            question="What is the main finding?",
            quote="Webs rebuilt after large prey carried higher tension.",
            why="It states the result.",
        )
        response = self.client.get(reverse("history"))
        self.assertContains(response, paper.stored_name)
        self.assertContains(response, "What is the main finding?")
        self.assertContains(response, "higher tension")

    def test_highlight_save_rejects_someone_elses_paper(self):
        self._upload()
        paper = SavedPaper.objects.get(user=self.user)
        self.client.login(username="bea", password="safe-password-123")
        response = self.client.post(
            reverse("save_highlight"),
            data=json.dumps({"paper_id": paper.id, "question": "Find it", "quote": "A long enough passage."}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(SavedHighlight.objects.count(), 0)

    def test_find_more_prompt_asks_for_a_different_passage(self):
        prompt = text_prompt("main finding", "Document text goes here.", ["Webs rebuilt after large prey."])
        self.assertIn("different place", prompt)
        self.assertIn("Webs rebuilt after large prey.", prompt)
