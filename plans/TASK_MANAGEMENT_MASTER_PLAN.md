# Task Management System — Master Plan

## System Overview

A full-featured task management system embedded inside each **Project** within the Workspace. Each project gets a **Tasks** section with a Kanban board, rich task detail, file sharing, team collaboration, and stats. Only the Project Admin and designated Task Supervisors can move tasks across status stages or mark them complete.

---

## Core Concepts

| Concept | Description |
|---|---|
| **Task** | Unit of work within a project. Has status, priority, due date, assignees, labels, subtasks, and attachments. |
| **Supervisor** | A project member assigned to a specific task who can change status and mark complete. |
| **Project Admin** | Always has full control: create/delete tasks, assign supervisors, drag on Board. |
| **Board** | Kanban view of tasks in 4 columns, draggable by Admin or Supervisor only. |
| **Label** | Color-coded tag, scoped to a project, applied to any task in that project. |

---

## Task Status States

| Status | Display | Sidebar Filter |
|---|---|---|
| `todo` | To Do | Yes |
| `in_progress` | In Progress | Yes |
| `in_review` | Need Review | Yes |
| `done` | Done | Yes |

---

## Task Priority Levels

`low` · `medium` · `high` · `urgent`

---

## Roles in Task Context

| Role | Can do |
|---|---|
| Project Admin | Everything: create, delete, reassign, drag board, change any status |
| Task Supervisor | Change status of their supervised tasks, mark complete, assign members |
| Task Assignee | Add comments, upload attachments, complete their own subtasks |
| Project Member | View tasks, comment, add reactions |

---

## DB Schema

### `tasks`
```sql
CREATE TABLE tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'todo',       -- todo | in_progress | in_review | done
  priority     TEXT NOT NULL DEFAULT 'medium',     -- low | medium | high | urgent
  position     INT NOT NULL DEFAULT 0,             -- sort order within status column (board)
  due_date     DATE,
  supervisor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
-- indexes
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status, position);
```

### `task_assignees`
```sql
CREATE TABLE task_assignees (
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (task_id, user_id)
);
```

### `task_labels`
```sql
CREATE TABLE task_labels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `task_label_assignments`
```sql
CREATE TABLE task_label_assignments (
  task_id  UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);
```

### `subtasks`
```sql
CREATE TABLE subtasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  position   INT NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `task_attachments`
```sql
CREATE TABLE task_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  size        INT,
  mime_type   TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### `task_comments`
```sql
CREATE TABLE task_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  parent_id  UUID REFERENCES task_comments(id) ON DELETE CASCADE,  -- NULL = top-level, set = reply
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);
```

### `task_comment_reactions`
```sql
CREATE TABLE task_comment_reactions (
  comment_id UUID NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL,   -- e.g. "👍", "🎉", "❤️"
  PRIMARY KEY (comment_id, user_id, emoji)
);
```

### `task_activity`
```sql
CREATE TABLE task_activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    UUID REFERENCES tasks(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id),
  action     TEXT NOT NULL,   -- 'created' | 'status_changed' | 'comment_added' | 'assigned' | etc.
  metadata   JSONB,           -- { from, to, value, ... }
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX task_activity_project_idx ON task_activity (project_id, created_at DESC);
CREATE INDEX task_activity_task_idx ON task_activity (task_id, created_at DESC);
```

---

## API Routes

### Tasks
| Method | Path | Description | Auth |
|---|---|---|---|
| GET | `/api/projects/:projectId/tasks` | List tasks (filter: status, assignee, label, q) | Member |
| POST | `/api/projects/:projectId/tasks` | Create task | Member |
| GET | `/api/projects/:projectId/tasks/:taskId` | Task detail (with assignees, labels, subtasks) | Member |
| PUT | `/api/projects/:projectId/tasks/:taskId` | Update task fields | Member (own) / Admin |
| DELETE | `/api/projects/:projectId/tasks/:taskId` | Delete task | Admin |
| PATCH | `/api/projects/:projectId/tasks/:taskId/status` | Change status (role-gated) | Admin / Supervisor |
| PATCH | `/api/projects/:projectId/tasks/reorder` | Bulk reorder after drag-drop | Admin / Supervisor |

### Assignees
| Method | Path | Description |
|---|---|---|
| POST | `/api/tasks/:taskId/assignees` | Assign a member |
| DELETE | `/api/tasks/:taskId/assignees/:userId` | Unassign a member |

### Labels
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:projectId/labels` | List project labels |
| POST | `/api/projects/:projectId/labels` | Create label |
| PUT | `/api/projects/:projectId/labels/:labelId` | Edit label |
| DELETE | `/api/projects/:projectId/labels/:labelId` | Delete label |
| POST | `/api/tasks/:taskId/labels/:labelId` | Attach label to task |
| DELETE | `/api/tasks/:taskId/labels/:labelId` | Detach label from task |

### Subtasks
| Method | Path | Description |
|---|---|---|
| POST | `/api/tasks/:taskId/subtasks` | Create subtask |
| PATCH | `/api/tasks/:taskId/subtasks/:subtaskId` | Toggle complete / rename |
| DELETE | `/api/tasks/:taskId/subtasks/:subtaskId` | Delete subtask |

### Attachments
| Method | Path | Description |
|---|---|---|
| POST | `/api/tasks/:taskId/attachments` | Upload file (multipart, reuse media service) |
| DELETE | `/api/tasks/:taskId/attachments/:attachmentId` | Delete attachment |

### Comments & Reactions
| Method | Path | Description |
|---|---|---|
| GET | `/api/tasks/:taskId/comments` | List comments + replies + reaction counts |
| POST | `/api/tasks/:taskId/comments` | Post comment or reply (body: content, parent_id?) |
| PUT | `/api/tasks/:taskId/comments/:commentId` | Edit comment (own only) |
| DELETE | `/api/tasks/:taskId/comments/:commentId` | Delete comment (own or admin) |
| POST | `/api/tasks/:taskId/comments/:commentId/reactions` | Toggle emoji reaction |

### Stats & Activity
| Method | Path | Description |
|---|---|---|
| GET | `/api/projects/:projectId/task-stats` | Overview stats: counts by status, overdue, member workload |
| GET | `/api/projects/:projectId/activity` | Project-wide activity feed (paginated) |
| GET | `/api/projects/:projectId/files` | All attachments in project (for Files tab) |

---

## Frontend Architecture

### Nav Integration

In `AppSidebar`, the **Tasks** nav item under each project expands to:
```
Tasks
  ├── All Tasks      → /workspace?view=tasks&filter=all
  ├── To Do          → /workspace?view=tasks&filter=todo
  ├── In Progress    → /workspace?view=tasks&filter=in_progress
  ├── Done           → /workspace?view=tasks&filter=done
  └── Need Review    → /workspace?view=tasks&filter=in_review
```

### Task Page Tabs

The Tasks page (`/workspace?view=tasks`) has these top-level tabs:

| Tab | Content |
|---|---|
| **Overview** | Completion rate ring, tasks by status bar chart, overdue alert, member workload cards, recent activity strip |
| **Board** | Kanban with 4 columns (To Do / In Progress / Need Review / Done). Drag-drop restricted to Admin + Supervisor. |
| **Files** | All attachments uploaded across all tasks in this project. Grid with file type icons, uploader, date, link back to task. |
| **Activity** | Full project activity timeline. Created, status changes, comments, assignments, label changes — all logged. |
| **Members** | Project members table with roles, task counts, invite/remove controls. |

### Component Breakdown

```
src/components/tasks/
  TasksPage.tsx              ← tab container, loads project context
  tabs/
    TaskOverview.tsx          ← stats + activity strip
    TaskBoard.tsx             ← Kanban DnD board
    TaskFiles.tsx             ← files grid
    TaskActivity.tsx          ← activity timeline
    TaskMembers.tsx           ← member management
  board/
    BoardColumn.tsx           ← single Kanban column (header + droppable cards)
    TaskCard.tsx              ← compact card (title, assignees, labels, due, priority dot)
  detail/
    TaskDetailPanel.tsx       ← slide-over or full-page task detail
    TaskDetailHeader.tsx      ← title, status, priority, supervisor
    TaskDetailSidebar.tsx     ← assignees, due date, labels, attachments
    SubtaskList.tsx           ← checklist with progress bar
    CommentSection.tsx        ← threaded comments
    CommentItem.tsx           ← single comment + replies + emoji reactions
    EmojiReactionBar.tsx      ← reaction bubbles + add reaction picker
    AttachmentList.tsx        ← file chips + upload drop zone
  shared/
    LabelPicker.tsx           ← multi-select label dropdown + inline create
    AssigneePicker.tsx        ← member avatar multi-select
    PriorityBadge.tsx         ← colored dot + label
    StatusBadge.tsx           ← colored pill
    DueDatePicker.tsx         ← date input with overdue highlight
```

### Drag-and-Drop Library

Use **`@hello-pangea/dnd`** (React 18 compatible fork of react-beautiful-dnd).

```
npm install @hello-pangea/dnd
```

The board wraps columns in `<DragDropContext onDragEnd={handleDragEnd}>`. Each column is a `<Droppable>`. Each card is a `<Draggable>`.

`handleDragEnd` logic:
1. If dropped outside a column → revert
2. If same column → reorder `position` within status
3. If different column → update `status` + `position`, call PATCH `/status` or PATCH `/reorder`
4. Guard: only execute if user is Admin or Supervisor of the dragged task

### Task Card (Board)

Each card shows:
- Title (truncated to 2 lines)
- Priority dot (colored circle: gray/blue/amber/red)
- Label chips (up to 3, then +N)
- Assignee avatars (stacked, up to 3)
- Subtask progress: `2/5` with mini bar
- Due date (red if overdue, amber if today)
- Comment count icon

### Task Detail Panel

Opens as a right-side panel (not full-page modal) — 480px wide, slides in. Left side (main content area) stays visible for context. Contains:

**Header**: Title (click to edit inline) · Status pill · Priority selector · `···` menu (delete, duplicate)

**Top bar**: Supervisor: [avatar selector] · Assignees: [multi-avatar] · Due: [date] · Created by: [name]

**Body**:
- Description → Tiptap rich text editor (lazy-loaded)
- Labels → LabelPicker
- Subtasks → checklist, progress bar, add inline
- Attachments → drop zone + file list

**Footer**: Comment section — threaded, with emoji reactions (👍 ❤️ 🎉 😂 🔥 ✅)

---

## Overview Tab — Stats Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Completion Rate          Tasks by Status                   │
│  [ring chart: 72%]        [bar: To Do 8 | In Progress 4 |  │
│                            In Review 2 | Done 18]          │
├─────────────────────────────────────────────────────────────┤
│  ⚠ 3 tasks overdue      📎 12 files shared                 │
│  💬 7 comments today    👥 5 active members                 │
├─────────────────────────────────────────────────────────────┤
│  Member Workload                                            │
│  [avatar] Alice   ████████░░  6 tasks                      │
│  [avatar] Bob     █████░░░░░  4 tasks                      │
│  [avatar] Carol   ███░░░░░░░  2 tasks                      │
├─────────────────────────────────────────────────────────────┤
│  Recent Activity                                            │
│  · Alice moved "Design homepage" to In Review  2h ago       │
│  · Bob added a comment on "API integration"    4h ago       │
└─────────────────────────────────────────────────────────────┘
```

---

## Board Tab — Kanban Layout

```
┌───────────────┐  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  TO DO   (8)  │  │ IN PROGRESS(4)│  │ NEED REVIEW(2)│  │   DONE  (18)  │
│  + Add task   │  │  + Add task   │  │  + Add task   │  │  + Add task   │
│               │  │               │  │               │  │               │
│ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │  │ ┌───────────┐ │
│ │ Task title│ │  │ │ Task title│ │  │ │ Task title│ │  │ │ Task title│ │
│ │ 🔴 High   │ │  │ │ 🟡 Med   │ │  │ │ 🟢 Low   │ │  │ │ ✅ Done  │ │
│ │ [AV][AV]  │ │  │ │ [AV]     │ │  │ │ [AV][AV]  │ │  │ │ [AV]     │ │
│ │ 2/5 ██░   │ │  │ │ Due Apr5  │ │  │ │ 💬 3      │ │  │ │          │ │
│ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │  │ └───────────┘ │
└───────────────┘  └───────────────┘  └───────────────┘  └───────────────┘
```

Drag handle appears on hover (left edge of card). Non-authorized users see the board read-only (no drag cursor, no handle).

---

## Build Phases

### Phase 1 — Foundation (Backend + List View)
1. Add all DB tables to `ensureDatabase()`
2. Build API: tasks CRUD, labels CRUD, task-stats
3. `TasksPage.tsx` with tab shell (Overview, Board, Files, Activity, Members)
4. Basic task list in sidebar filter views (All, To Do, In Progress, Done, Need Review)
5. Create task form (title, description, priority, due date, assignees, labels)

### Phase 2 — Board (Kanban DnD)
1. Install `@hello-pangea/dnd`
2. `TaskBoard.tsx` with 4 columns
3. `TaskCard.tsx` compact card
4. Drag-and-drop with role guard
5. Column-level "Add task" quick-create

### Phase 3 — Task Detail Panel
1. `TaskDetailPanel.tsx` slide-over
2. Subtasks (add, toggle, reorder, progress bar)
3. Assignees multi-picker from project members
4. Labels multi-picker + inline create
5. Supervisor selector
6. Due date with overdue highlight

### Phase 4 — Collaboration
1. Attachments (upload, list, delete) — reuse existing media routes
2. `CommentSection.tsx` — post, reply, edit, delete
3. Emoji reactions (pick from 6 quick emojis)
4. `task_activity` logging on every mutation (middleware helper)

### Phase 5 — Overview, Files & Activity Tabs
1. `TaskOverview.tsx` — stats cards, ring chart (Recharts), member workload bars
2. `TaskFiles.tsx` — all project files grid
3. `TaskActivity.tsx` — full timeline

---

## Key Design Decisions

| Decision | Choice | Reason |
|---|---|---|
| Drag-and-drop lib | `@hello-pangea/dnd` | React 18 compatible, battle-tested API |
| Task detail UX | Slide-over panel (not modal) | Board stays visible for context |
| Attachment storage | Reuse existing media service + S3/CDN | No new infrastructure |
| Comment threading | 1-level replies only (parent_id) | Keeps UI simple; deep nesting rarely needed in task tools |
| Role enforcement | Server-side on PATCH /status and PATCH /reorder | Never trust client for role checks |
| Status changes | Only Admin + Supervisor; assignees can't self-move | Mirrors real project workflows |
| Board position | Float `position` INT per (project, status) combo | Simple re-ordering; no fractional index needed |
| Rich text | Tiptap (already in stack) | Consistent with rest of platform |
| Emoji reactions | Fixed set of 6 + custom picker | Fast UX, avoids emoji search complexity |

---

## Sidebar Integration (AppSidebar)

When a project is expanded in the sidebar, **Tasks** gets a dropdown arrow with these filter links:

```
📋 Tasks
   ├── All Tasks
   ├── To Do
   ├── In Progress
   ├── Done
   └── Need Review
```

Clicking any filter opens the Workspace page at the correct view with the filter pre-applied. The active filter is highlighted in the sidebar.

---

## Summary of Files to Create

```
packages/web/src/
  components/tasks/
    TasksPage.tsx
    tabs/TaskOverview.tsx
    tabs/TaskBoard.tsx
    tabs/TaskFiles.tsx
    tabs/TaskActivity.tsx
    tabs/TaskMembers.tsx
    board/BoardColumn.tsx
    board/TaskCard.tsx
    detail/TaskDetailPanel.tsx
    detail/SubtaskList.tsx
    detail/CommentSection.tsx
    detail/CommentItem.tsx
    detail/EmojiReactionBar.tsx
    detail/AttachmentList.tsx
    shared/LabelPicker.tsx
    shared/AssigneePicker.tsx
    shared/PriorityBadge.tsx
    shared/StatusBadge.tsx

packages/api/src/server.ts
  → 9 new DB tables in ensureDatabase()
  → ~25 new API routes under /api/projects/:id/tasks and /api/tasks/:id/*
```
