# How a search moves through the site

```mermaid
flowchart TD
  visitor[Visitor] --> signIn[Sign in or create an account]
  signIn --> page[Paper spider page]
  page --> find[Press Find it]
  find --> check{Account already locked?}
  check -->|Yes| lockedPage[Show the locked page]
  check -->|No| count[Add 1 to the search count]
  count --> tenth{Was this search number 10?}
  tenth -->|Yes| markLocked[Mark the account locked after this answer]
  tenth -->|No| stillOpen[Account stays open]
  markLocked --> answer[Show the passage and walk the spider]
  stillOpen --> answer
  answer --> nextTry[Next Find it]
  nextTry --> check
```

The count is stored in the `Usage` table, one row per account. `SearchLog` stores the time of each search and whether it was text or a picture. The paper itself is not stored.
