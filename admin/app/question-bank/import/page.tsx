import { redirect } from 'next/navigation';
import { requireStaff } from '../../../lib/auth';
import { AdminShell } from '../../../components/AdminShell';
import { PageHeader } from '../../../components/PageHeader';
import { contentRights } from '../../../lib/question-bank/data';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportQuestionBankPage() {
  const staff = await requireStaff();
  const { profile } = staff;
  if (!contentRights(profile).canEdit) redirect('/question-bank');

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <div className="mx-auto max-w-225">
        <PageHeader
          back={{ href: '/question-bank', label: 'Back to question bank' }}
          title="Import a workbook"
          description="Check the file first. A draft is created only when there are no errors, and nothing goes live until it is reviewed and published."
        />
        <ImportForm />
      </div>
    </AdminShell>
  );
}
