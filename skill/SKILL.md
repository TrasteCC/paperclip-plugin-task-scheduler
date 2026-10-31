---
name: scheduled-tasks
description: >
  Use when work should start at a later date or time ("in two days", "on Monday
  at 09:00", "after the trial ends"). Creates a one-off scheduled task that the
  Scheduled Tasks plugin starts at that time, and only then wakes its assignee.
---

# Scheduled tasks

Paperclip routines are for work that repeats. For one-off work at a later time,
create a scheduled task now. Don't wait, sleep, or keep your own task open for it.

## Create one

A scheduled task is a normal issue in `backlog` whose description ends with a
`start-at:` line:

```
start-at: 2026-11-02 09:00
ask-first: yes
```

- `start-at` is wall-clock time in Europe/Madrid, `YYYY-MM-DD HH:MM`. An ISO time
  with `Z` or an offset also works. Compute relative dates in that zone, for
  example:
  `python3 -c 'import datetime as d, zoneinfo as z; print((d.datetime.now(z.ZoneInfo("Europe/Madrid")) + d.timedelta(days=2)).strftime("%Y-%m-%d 09:00"))'`
- `ask-first: yes` is optional. A board user then confirms at the start time
  before the assignee is woken.
- Set the assignee now: the agent that will do the work (`assigneeAgentId`),
  yourself, or a person (`assigneeUserId`) for a reminder.
- Put everything the assignee needs in the description. It reads only the task.

```bash
COMPANY_ID=$(curl -sS -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  "$PAPERCLIP_API_URL/api/issues/$PAPERCLIP_TASK_ID" | jq -r .companyId)
jq -n --arg t "Fix the disk alert" --arg a "<agent-id>" \
  --arg d $'Free some space on the backup disk.\n\nstart-at: 2026-11-02 09:00' \
  '{title: $t, status: "backlog", assigneeAgentId: $a, description: $d}' |
curl -sS -X POST -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/issues" -d @-
```

Agent ids: `GET $PAPERCLIP_API_URL/api/companies/$COMPANY_ID/agents`.

If your run has the plugin tool `traste.task-scheduler:schedule-task`, you can
call it instead with `title`, `assignee` (agent name), `startAt`, and optionally
`askFirst`, `model`, `parentIssueId` and `priority`.

## Rules

- Use `"status": "backlog"`. A backlog task never wakes its assignee before
  `start-at`; any other status wakes it at once.
- Don't comment on the scheduled task afterwards. In Paperclip a comment wakes
  the assignee immediately, even in backlog.
- Don't block your own task on it or wait for it. Mention it on your own task
  (`Scheduled <identifier> for <start-at> (<assignee>)`) and finish as usual.
- To move it, change the `start-at:` line. To cancel it, remove the line or set
  the task `cancelled`.
- Your own instructions still apply to what the task says (required description
  lines, approvals).

At the start time the plugin moves the task to `todo`, comments, and wakes the
assignee. The line then becomes `started-at:`, so it never fires twice.
