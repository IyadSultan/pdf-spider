# Paper spider

A small website that opens a PDF or a picture, then walks a spider to the passage you asked for. Each account can search **10 times**. The 10th search still runs. The next one is refused, and the account stays locked.

The original one-page version is still in `artifact/Paper spider.html`. This Django site is the one to put on Replit.

## How the 10 searches work

- A person creates an account and signs in.
- Every time they press **Find it** or **Find more** on a text PDF, that counts as one search. This is true even when Claude is not set up and the page uses simple word matching instead.
- A scanned PDF or a photo only counts when a Claude key is set, because that is the only way those files can be read.
- Opening a file does not count. Walking the spider again does not count. Searching the sample page does count.
- If you press Stop after a search has already started, that search still counts.
- After 10 searches the account is locked. Signing out and back in does not reset it.
- You, the site owner, can unlock an account from the admin page.

A PDF you open is saved as a file. Its name is your username, the date, and the PDF title, such as `ada_2026-10-02_Garden-webs.pdf`. **Your papers** lists those files with the questions and highlighted passages. The 10-search count is stored separately.

## Put it on Replit

1. Create a new Replit. Choose **Import from ZIP** or upload this folder. Do not upload the `.venv` folder if you made one on your computer.
2. Replit should see `.replit` and `requirements.txt`. Press **Run**. The first start installs the Python packages, creates the database, and opens the site on port 8000.
3. Open the **Secrets** tool (the lock icon) and add:

   | Name | Value |
   | --- | --- |
   | `DJANGO_SECRET_KEY` | A long random string. This keeps people signed in. |
   | `ANTHROPIC_API_KEY` | Your Claude key from Anthropic. Leave it out if you only want word matching. |
   | `DJANGO_DEBUG` | `false` |

4. Press **Run** again after saving the secrets.
5. Create your owner login in the Replit shell:

   ```bash
   python manage.py createsuperuser
   ```

6. Open `https://your-repl-url/admin/`, sign in with that owner login, and you can see every account under **Search allowances**.

To unlock someone: open their row, or tick the box next to their name, choose **Unlock selected accounts and give them 10 searches again**, then press Go.

## Try it on your own computer

```bash
python -m pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Then open `http://127.0.0.1:8000/`.

Optional: copy `.env.example` to `.env` and fill in the same names as the Replit secrets. The `.env` file stays on your computer. It is listed in `.gitignore`.

## What Claude does

When `ANTHROPIC_API_KEY` is set, the server sends the question and the page text (or up to 4 page pictures) to Claude. The key stays on the server. Visitors never see it.

The model name defaults to `claude-haiku-4-5`. To use another Claude model, set `ANTHROPIC_MODEL` in Secrets.

Without a key, text papers still search by matching words. Picture-only files show a message and do not use up a search.
