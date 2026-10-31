import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { SKILL_MARKDOWN } from "./skill.js";

export const JOB_KEY = "start-due-tasks";
export const TOOL_NAME = "schedule-task";
export const PAGE_ROUTE = "scheduled";
export const SKILL_KEY = "scheduled-tasks";
/** Adapters that honor a per-issue model override (same set as the host's New Issue dialog). */
export const MODEL_ADAPTERS = new Set(["claude_local", "codex_local", "opencode_local"]);

const manifest: PaperclipPluginManifestV1 = {
  id: "traste.task-scheduler",
  apiVersion: 1,
  version: "0.2.0",
  displayName: "Scheduled Tasks",
  description: "Schedule one-off tasks to start at a set date and time. The assigned agent is only woken when that time comes.",
  author: "traste",
  categories: ["automation", "ui"],
  capabilities: [
    "companies.read",
    "agents.read",
    "issues.read",
    "issues.create",
    "issues.update",
    "issues.wakeup",
    "issue.comments.create",
    "issue.interactions.create",
    "issue.interactions.read",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
    "agent.tools.register",
    "skills.managed",
    "ui.page.register",
    "ui.sidebar.register",
    "ui.detailTab.register",
    "ui.action.register",
    "ui.dashboardWidget.register",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  // The host only lets the scheduler job act on companies that have a saved plugin config,
  // so this switch is also what authorizes the job for a company.
  instanceConfigSchema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        title: "Start scheduled tasks in this company",
        description: "When on, backlog tasks with a start-at line are started at their time.",
        default: true,
      },
    },
  },
  jobs: [
    {
      jobKey: JOB_KEY,
      displayName: "Start due tasks",
      description: "Every minute: start backlog tasks whose start-at time has come.",
      schedule: "* * * * *",
    },
  ],
  // Installed into each enabled company's skills library; attach it to agents to teach them the convention.
  skills: [
    {
      skillKey: SKILL_KEY,
      displayName: "Scheduled tasks",
      description: "Create one-off tasks that start at a set date and time; the assignee is only woken then.",
      markdown: SKILL_MARKDOWN,
    },
  ],
  tools: [
    {
      name: TOOL_NAME,
      displayName: "Schedule a task",
      description:
        "Create a task that starts later. It stays in backlog, and its assignee is only woken at startAt (Europe/Madrid wall-clock time). Use it for follow-ups such as 'have another agent fix this in 2 days'.",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Task title." },
          description: { type: "string", description: "What to do, in markdown." },
          assignee: { type: "string", description: "Name of the agent that will do the task, exactly as shown in Paperclip." },
          startAt: { type: "string", description: "When to start: 'YYYY-MM-DD HH:MM' in Europe/Madrid time." },
          askFirst: { type: "boolean", description: "Ask a board user to confirm before the agent is woken. Default false." },
          model: { type: "string", description: "Optional model override for this task only." },
          parentIssueId: { type: "string", description: "Optional parent issue id, usually the issue you are working on." },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
        },
        required: ["title", "assignee", "startAt"],
      },
    },
  ],
  ui: {
    slots: [
      {
        type: "page",
        id: "task-scheduler-page",
        displayName: "Scheduled",
        exportName: "ScheduledPage",
        routePath: PAGE_ROUTE,
      },
      {
        type: "sidebar",
        id: "task-scheduler-sidebar",
        displayName: "Scheduled",
        exportName: "ScheduledSidebarLink",
      },
      {
        // A toolbar button, not a detailTab: the 2026.10 chat-style task page hides the tab strip
        // but still renders toolbar buttons under the task header.
        type: "toolbarButton",
        id: "task-scheduler-issue-button",
        displayName: "Schedule",
        exportName: "IssueScheduleButton",
        entityTypes: ["issue"],
      },
      {
        type: "dashboardWidget",
        id: "task-scheduler-widget",
        displayName: "Scheduled tasks",
        exportName: "ScheduledWidget",
      },
    ],
  },
};

export default manifest;
