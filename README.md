<p align="center">
  <img src="docs/scheduled-page.webp" alt="Scheduled page in Paperclip: tasks grouped by Today, Tomorrow and Next 7 days, each with its start time, assigned agent and a Start now button" width="760" />
</p>

<p align="center">
  <a href="#-install"><strong>Install</strong></a> &middot;
  <a href="#-how-to-use-it"><strong>How to use it</strong></a> &middot;
  <a href="#-for-agents-and-the-api"><strong>For agents</strong></a> &middot;
  <a href="https://github.com/paperclipai/paperclip"><strong>Paperclip</strong></a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>
  <a href="https://github.com/paperclipai/paperclip"><img src="https://img.shields.io/badge/Paperclip-%E2%89%A5%202026.1023.0-3b6d11" alt="Paperclip 2026.1023.0 or later" /></a>
  <img src="https://img.shields.io/badge/starts%20within-1%20min-534ab7" alt="Starts within one minute" />
  <img src="https://img.shields.io/badge/data%20lock--in-none-ba7517" alt="No data lock-in" />
</p>

<br/>

# ⏰ Scheduled Tasks: start agent work at a set time in Paperclip

**Create the task now, assign the agent now. The agent wakes up only when the time comes.**

> I built this plugin because I kept scheduling follow-ups by hand: rotate a
> key in two weeks, review a test after its trial period, check something on
> Monday morning. First I used yearly cron routines that had to pause
> themselves, then a poller outside Paperclip that nobody could see. Now the
> task lives in Paperclip from day one, with its agent, and starts on its own.
> I'd love to hear your feedback!

A [Paperclip](https://github.com/paperclipai/paperclip) plugin for one-off
tasks with a start date, much like the "Upcoming" list of a to-do app. The
task waits in backlog with its assignee already set, and at the start time the
plugin moves it to todo and wakes the agent.

<br/>

## Scheduled Tasks is right for you if

- ✅ You keep **follow-ups for later**: renewals, reviews, Monday checks
- ✅ You want the agent **assigned now** but **woken later**
- ✅ Your agents should be able to **schedule work for each other**
- ✅ You're tired of **cron routines that have to switch themselves off**

<br/>

## Features

<table>
<tr>
<td align="center" width="33%">
<h3>🗓️ Upcoming view</h3>
Today, Tomorrow, Next 7 days and Later, with start, reschedule and unschedule on every row.
</td>
<td align="center" width="33%">
<h3>⏰ Starts on time</h3>
A job checks every minute, moves the task to todo and wakes its agent through Paperclip's own heartbeat.
</td>
<td align="center" width="33%">
<h3>🙋 Ask me first</h3>
Optional per task: at the start time you get a confirmation card instead of a wake-up.
</td>
</tr>
<tr>
<td align="center">
<h3>🤖 Agents schedule too</h3>
Any agent can create one through the normal issues API, or with the <code>schedule-task</code> tool.
</td>
<td align="center">
<h3>🧠 Model per task</h3>
Pick a model for that run only, with the same override Paperclip's New Issue dialog uses.
</td>
<td align="center">
<h3>🔓 No lock-in</h3>
The date is a line in the task itself. Uninstall the plugin and nothing is lost.
</td>
</tr>
</table>

<p align="center">
  <img src="docs/mobile.webp" width="300" alt="Scheduled page on a phone: each task shows its time, title, agent and a Start now button">
</p>

<br/>

## 📦 Install

Scheduled Tasks needs Paperclip 2026.1023.0 or later.

```bash
git clone https://github.com/TrasteCC/paperclip-plugin-task-scheduler.git
cd paperclip-plugin-task-scheduler
pnpm install
pnpm build
paperclipai plugin install /path/to/paperclip-plugin-task-scheduler
```

The installable package is `package.json` plus `dist/`; `node_modules/` is not
needed at runtime.

**Then turn it on in each company.** Open Company Settings > Plugins >
Scheduled Tasks, switch on **Start scheduled tasks in this company** and click
Save Configuration. Paperclip only lets a plugin's background job act in
companies where the plugin has a saved configuration, so a company without it
never starts its tasks. The Scheduled page shows a warning when it is off.

The plugin asks for: read and update issues, add comments and confirmation
cards, read agents and wake them, its own state, one scheduled job, one agent
tool, and the page, sidebar, toolbar button and dashboard widget slots. The
full list is in [`src/manifest.ts`](src/manifest.ts).

## 🚀 How to use it

1. Open **Scheduled** in the sidebar and click **New scheduled task**.
2. Fill in the title and description, pick the agent (or a person) and the
   start time. Optionally choose a project, a model for this run, the
   priority, and **Ask me before waking the agent**.
3. Click **Schedule task**. The task waits in backlog: it doesn't show in the
   agent's inbox and nothing wakes the agent before the start time.

<p align="center">
  <img src="docs/new-task.webp" width="438" alt="New scheduled task dialog: title, description, assignee, project, start time in Europe/Madrid, ask first, model and priority">
</p>

Any backlog or todo task can be scheduled from its own page too. The button
under the task header reads **Schedule…**, or the start time once it has one.
It opens a panel to reschedule, start now or unschedule.

<table>
<tr>
<td align="center" width="50%"><img src="docs/task-button.webp" width="325" alt="Task page with a Starts Tue 3 Nov, 09:00 button and an Ask first badge under the title"></td>
<td align="center" width="50%"><img src="docs/schedule-panel.webp" width="438" alt="Scheduled start panel: start date, Start now, Unschedule, a date picker and the ask first option"></td>
</tr>
</table>

The dashboard gets a **Scheduled** card with the next five starts.

<p align="center">
  <img src="docs/dashboard-widget.webp" width="292" alt="Scheduled dashboard card listing the next five tasks with their start times">
</p>

### ⏰ What happens at the start time

| Task | At the start time |
|---|---|
| Assigned to an agent | Moves to todo, gets a comment, and the agent is woken |
| Assigned to an agent, **ask first** on | A confirmation card appears on the task. Accept starts it as above; decline keeps it in backlog |
| Assigned to a person | Moves to todo with a comment, so it shows in their inbox |
| Date it can't read | Stays in backlog with a comment explaining the expected format |

If the agent can't be woken (paused, out of budget, blocked by another task),
the task still moves to todo and the reason is posted as a comment.

## 🤖 For agents (and the API)

Paperclip tasks have no date field, so the schedule is two lines in the task
description. The date picker writes them for you:

```
start-at: 2026-11-02 09:00
ask-first: yes
```

`start-at` is wall-clock time in Europe/Madrid. An ISO time with `Z` or an
offset (`2026-11-02T08:00Z`) also works. `ask-first` is optional.

So any agent, script or person can schedule work with the normal issues API,
without the plugin's tool: create a **backlog** task with its assignee and the
line.

```bash
curl -X POST "$PAPERCLIP_API_URL/api/companies/$COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Fix the disk alert",
    "status": "backlog",
    "assigneeAgentId": "<agent-id>",
    "description": "Free some space on the backup disk.\n\nstart-at: 2026-11-02 09:00"
  }'
```

A short section in an agent's instructions is enough to teach it:

```markdown
## Scheduling work for later
When a task asks for work at a later time ("have the maintenance agent fix
this in 2 days"), don't wait: create the task now with "status": "backlog",
its assignee set, and as the last line of the description
`start-at: YYYY-MM-DD HH:MM` (Europe/Madrid). Add `ask-first: yes` when a
human must confirm at that moment. Then finish your own task as usual.
```

Agents that get plugin tools can also call **`schedule-task`**:

| Parameter | Required | Meaning |
|---|---|---|
| `title` | yes | Task title |
| `assignee` | yes | Agent name, as shown in Paperclip |
| `startAt` | yes | `YYYY-MM-DD HH:MM`, Europe/Madrid |
| `description` | no | Markdown |
| `askFirst` | no | Ask a board user before waking the agent |
| `model` | no | Model override for this task only |
| `parentIssueId` | no | Parent task |
| `priority` | no | `critical`, `high`, `medium` or `low` |

## 🗄️ Where the data lives

- **The schedule is in the task.** It survives plugin upgrades and
  reinstalls, you can edit it from the task page, and it never fires twice:
  once the task starts, the key becomes `started-at:` (or `start-declined:`
  after a declined confirmation, `start-at-invalid:` for a date it can't read),
  so the line stays as history.
- **Plugin state** holds only the id of a pending confirmation card.
- **Plugin configuration** holds `{ "enabled": true }` per company.

Times skipped by a daylight-saving jump move forward by the jump (02:30 on the
spring-forward day starts at 03:30). A time that happens twice when clocks go
back uses the second one.

## ⚙️ How it works

| Piece | What it does |
|---|---|
| Job `start-due-tasks` (`* * * * *`) | Lists backlog tasks in each enabled company, finds due `start-at` lines, moves them to todo and wakes the assignee. One failing task never blocks the others. |
| `page` + `sidebar` | The **Scheduled** page and its sidebar link. |
| `toolbarButton` on issues | The button under the task header. A `detailTab` would not do: Paperclip's chat-style task page hides the tab strip. |
| `dashboardWidget` | The **Scheduled** card. |
| Tool `schedule-task` | Creates a scheduled task on behalf of an agent. |

It leans on three Paperclip behaviors. Assigning an agent to a **backlog**
task does not wake it. An agent's inbox lists only todo, in progress and
blocked tasks. And a wake-up request is refused for backlog tasks, so the
plugin changes the status first and then wakes the agent. The UI is built
from the SDK's components (assignee and project pickers, markdown editor,
toasts) and Paperclip's theme variables, so it picks up Paperclip's look.

## 🛠️ Building from source

The toolchain matches Paperclip's plugin scaffold: esbuild with the SDK's
`createPluginBundlerPresets`, Vitest and TypeScript. `@paperclipai/plugin-sdk`
and `@paperclipai/shared` are pinned to `2026.1023.0`; change the pin to match
the Paperclip you run.

```bash
pnpm install
pnpm typecheck
pnpm test        # schedule parsing (incl. daylight-saving edges), the worker and the agent tool
pnpm build
```

To update an installed copy, replace `package.json` and `dist/`, then run
`POST /api/plugins/<id>/upgrade`. After any Paperclip or plugin upgrade, check
that the `start-due-tasks` job has a recent successful run. The health check
alone only looks at the registry.

## ⚠️ Known limits

- The time zone is fixed to Europe/Madrid (`TIMEZONE` in `src/schedule.ts`).
- The date shows as a line in the task description, because Paperclip has no
  date field for tasks and plugins can't add one.
- The create dialog has no attachments yet. Create the task, then attach files
  from its page.
- A model override can only be set when the task is created, and only for
  `claude_local`, `codex_local` and `opencode_local` agents.
- Tasks start within about a minute of their time.
- Paperclip refuses an upgrade that adds a capability, and as of 2026.1023 a
  refused upgrade leaves the plugin unloaded while it still reports `ready`.
  Uninstall and reinstall to add one.

## 📄 License

MIT
