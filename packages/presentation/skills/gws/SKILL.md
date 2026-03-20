---
name: gws
description: >
  Use this skill when asked to interact with Google Workspace services using
  the `gws` CLI — including Drive, Gmail, Sheets, Calendar, Docs, Slides,
  Tasks, Chat, People, Forms, Keep, Meet, Classroom, or cross-service workflows.
  Covers auth, API commands, schema discovery, pagination, and file
  upload/download. Does NOT cover non-Workspace Cloud APIs (`gcloud` for those).
---

## Commands

```bash
# --params = URL/query params; --json = request body (wrong flag → 400 or silent drop)
# docs: get returns first tab only; add includeTabsContent=true for all tabs
# docs batchUpdate: body starts at index 1; add "tabId":"TAB_ID" to location for specific tab
# sheets valueInputOption: RAW = literal; USER_ENTERED = parse formulas/dates as typed
gws auth login                  # browser OAuth
gws auth login -s drive,gmail   # specific services
gws schema drive.files.list    # params; --resolve-refs to inline $refs
gws drive files upload --upload ./file.pdf --json '{"name":"file.pdf"}'  # MIME auto-detected

gws gmail users messages list --params '{"userId": "me", "q": "is:unread"}'

# sheets
gws sheets spreadsheets create --json '{"properties":{"title":"My Sheet"}}'
gws sheets spreadsheets values get --params '{"spreadsheetId": "ID", "range": "Sheet1!A1:D10"}'
gws sheets spreadsheets values update \
  --params '{"spreadsheetId":"ID","range":"A1","valueInputOption":"RAW"}' \
  --json '{"values":[["a","b"],["c","d"]]}'
gws sheets +read --spreadsheet ID --range 'Sheet1!A1:D10'   # read helper
gws sheets +append --spreadsheet ID --values 'Alice,100'    # append row helper; --json-values for multi-row

# docs
gws docs documents create --json '{"title":"My Doc"}'   # only title used; body ignored
gws docs documents get --params '{"documentId":"DOC_ID","includeTabsContent":true}'
gws docs documents batchUpdate --params '{"documentId":"DOC_ID"}' \
  --json '{"requests":[{"updateTextStyle":{"range":{"startIndex":1,"endIndex":6},"textStyle":{"bold":true},"fields":"bold"}}]}'
gws docs +write --document DOC_ID --text 'Hello'  # plain text append (no formatting)

gws calendar events list --params '{"calendarId": "primary"}'

gws tasks tasks insert --params '{"tasklist": "@default"}' --json '{"title": "My task"}'

gws drive files list --page-all    # NDJSON (one per line); pipe jq -s '.' for array; --page-limit N
gws workflow standup-report    # today's meetings + open tasks
# also: meeting-prep, email-to-task, weekly-digest, file-announce (gws wf)
```


