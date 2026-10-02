# Project status

## Completed steps

- Read the original Paper spider page in `artifact/Paper spider.html`.
- Built a Django site that keeps the same reader: open a PDF or image, ask a question, and the spider walks to the passage.
- Added accounts. Each account may press Find it 10 times. The 10th search still returns an answer, then the account locks.
- The lock is stored in the database, so refreshing the page does not reset it.
- Claude calls go through the server when `ANTHROPIC_API_KEY` is set. Without a key, text search uses word matching and still counts.
- Added Replit run files: `.replit`, `run.sh`, and `requirements.txt`.
- Added an admin action that unlocks an account and gives it 10 searches again.

- Added Find more, which looks for a different passage and counts as one search.
- Saved PDFs are stored as files named username_date_title.pdf. Your papers lists each PDF with its questions and highlights.
- The spider parks beside a match. The words stay visible and are only highlighted.
- The page highlight waits until the spider reaches the passage. The quote still shows in the box below as soon as it is found.
- The page scrolls with the spider and does not race ahead of the walk.
- Find more still highlights the passage when the spider arrives, including near the top or bottom of the paper where the page cannot scroll any further.
- The account named isultan is unlimited. Other accounts still lock after 10 searches.
- The browser tab shows a small spider icon.
- The entire PDF is displayed, and picture-based searches include every page. Uploaded PDFs remain limited to 30 MB.

## Current tasks

- Automated tests passed (account starts at 0, search 10 works, search 11 is locked, picture search without a Claude key does not count).
- You put the folder on Replit and add `DJANGO_SECRET_KEY` and, if you want Claude, `ANTHROPIC_API_KEY`.

## Remaining tasks

- Create the owner login on Replit with `python manage.py createsuperuser`.
- Press Run on Replit and sign up with a normal account to see the 10-search counter.
