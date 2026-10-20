import { redirect } from 'next/navigation';

// "Timesheet PDFs by Pay Period" moved to /user-management (exec only). This keeps old links and
// bookmarks to /event-dashboard working; event pages stay at /event-dashboard/[id].
export default function EventDashboardIndexPage() {
  redirect('/user-management#timesheet-zips');
}
