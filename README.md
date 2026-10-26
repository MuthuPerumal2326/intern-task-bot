# InternFlow — Intern Task & Review Bot

A runnable starter project for managing 100 interns, allocating tasks, exporting the roster to Excel, scheduling review rounds, accepting project submissions, producing review feedback, and moving completed candidates to the next stage.

## Requirements
- Node.js 18+
- npm
- Optional: SMTP account for real emails; optional OpenAI API key for AI-assisted feedback.

## Run it
1. Extract this ZIP.
2. Open a terminal in `intern-task-bot/backend`.
3. Run `npm install`
4. Copy `.env.example` to `.env` and edit values if you want real email/AI.
5. Run `npm start`
6. Open `http://localhost:4000`

The backend serves the frontend, so one terminal is enough.

## Demo mode vs real integrations
- Without SMTP credentials, emails are recorded in the app's **Notifications** area and printed to the terminal; they are not actually delivered.
- Without an OpenAI API key, submission review uses a transparent heuristic checklist. Add `OPENAI_API_KEY` to enable AI-generated suggestions. AI feedback is advisory; a human should make final candidate decisions.
- Audio feedback uses the browser's built-in speech synthesis. Voice availability depends on the browser/OS.
- Excel export downloads a CSV file that opens in Excel. The app also accepts `.csv` intern rosters. For native `.xlsx` support, the `xlsx` package is included and can be used for future extension.
- Review meeting links are generated as configurable placeholders. Replace with your organization's real meeting link.
- This is a local development starter, not production-ready. Before company use, add authentication/roles, secure file storage, malware scanning, audit logs, retention rules, and deployment secrets management.

## Workflow
1. Add interns manually or import a CSV with `name,email,task`.
2. Assign unique tasks (auto-assign is available).
3. Set review 1 date/time/link and send notifications.
4. Interns submit a project file through the Submission page.
5. Review results and feedback; use **Read feedback aloud** to hear it.
6. Mark a candidate **Advance** or schedule review 2 / review 3 for those who need more work.
7. Export the roster and progress to CSV for Excel.

## Useful API routes
- `GET /api/dashboard`
- `GET /api/interns`
- `POST /api/interns`
- `POST /api/interns/import`
- `POST /api/interns/auto-assign`
- `GET /api/interns/export`
- `POST /api/reviews/send`
- `POST /api/submissions`
- `POST /api/submissions/:id/review`
- `POST /api/interns/:id/advance`
- `POST /api/interns/:id/schedule-review`
- `GET /api/notifications`
