import { redirect } from 'next/navigation';

// The Team page moved to /team (owner, 2026-11-20). Old links and bookmarks land there.
export default function OldTeamAddress() {
  redirect('/team');
}
