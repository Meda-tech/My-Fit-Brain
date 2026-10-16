'use client';

import { useState, useActionState } from 'react';
import {
  CheckCircle2,
  X,
  Plus,
  UserX,
  CircleOff,
  AlertCircle,
} from 'lucide-react';
import { Profile } from '../../lib/types';
import { ROLE_LABELS, TEAM_ROLES } from '../../lib/roles';
import { PageHeader } from '../../components/PageHeader';
import {
  createTeamMemberAction,
  toggleStatusAction,
  resetPasswordAction,
  TeamActionState,
} from './actions';
import {
  Button,
  Card,
  Notice,
  Pill,
  helpTextClasses,
  inputClasses,
  labelClasses,
} from '../../components/brand';

interface TeamListClientProps {
  initialTeam: Profile[];
}

const requiredMark = (
  <span className="text-coral-deep" aria-hidden>
    *
  </span>
);

const closeButtonClasses =
  'inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-ink-muted hover:bg-mist hover:text-teal transition-colors';

export function TeamListClient({ initialTeam }: TeamListClientProps) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resetModalId, setResetModalId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const [state, formAction, isPending] = useActionState<TeamActionState | null, FormData>(
    async (prev, formData) => {
      const res = await createTeamMemberAction(prev, formData);
      if (res.success) {
        setCreateModalOpen(false);
        setToastMessage(res.message || 'Team member added.');
      }
      return res;
    },
    null
  );

  const handleToggleStatus = async (member: Profile) => {
    try {
      setStatusTogglingId(member.id);
      const res = await toggleStatusAction(member.id, !member.is_active);
      if (!res.success) {
        alert(res.error || 'Failed to update status');
      } else {
        setToastMessage(
          `${ROLE_LABELS[member.role]} ${member.full_name} marked as ${!member.is_active ? 'active' : 'inactive'}.`
        );
      }
    } finally {
      setStatusTogglingId(null);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalId || !newPassword) return;

    try {
      setResetting(true);
      const res = await resetPasswordAction(resetModalId, newPassword);
      if (!res.success) {
        alert(res.error || 'Failed to reset password');
      } else {
        setToastMessage('Password reset successfully.');
        setResetModalId(null);
        setNewPassword('');
      }
    } finally {
      setResetting(false);
    }
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  const roleBadge = (member: Profile) => (
    <Pill className="whitespace-nowrap">{ROLE_LABELS[member.role]}</Pill>
  );

  const statusPill = (member: Profile) =>
    member.is_active ? (
      <Pill>
        <CheckCircle2 size={13} strokeWidth={2} aria-hidden />
        Active
      </Pill>
    ) : (
      <Pill tone="quiet">
        <CircleOff size={13} strokeWidth={2} aria-hidden />
        Inactive
      </Pill>
    );

  const renderActions = (member: Profile) => (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => handleToggleStatus(member)}
        disabled={statusTogglingId === member.id}
        title={member.is_active ? 'Deactivate account' : 'Activate account'}
      >
        {member.is_active ? 'Deactivate' : 'Activate'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setResetModalId(member.id)}>
        Reset password
      </Button>
    </>
  );

  return (
    <div>
      {/* Toast feedback */}
      {toastMessage && (
        <Notice
          variant="info"
          role="status"
          icon={<CheckCircle2 size={18} strokeWidth={2} />}
          className="mb-5"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className={closeButtonClasses}
              aria-label="Dismiss message"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </Notice>
      )}

      <PageHeader
        title="Team"
        description="Create and manage coordinator and counsellor accounts and their access."
        actions={
          <Button variant="primary" onClick={() => setCreateModalOpen(true)}>
            <Plus size={18} strokeWidth={2} aria-hidden />
            <span>Add team member</span>
          </Button>
        }
      />

      {/* Team Table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {initialTeam.length} {initialTeam.length === 1 ? 'team member' : 'team members'}
          </p>
        </div>

        {initialTeam.length === 0 ? (
          <div className="p-12 text-center">
            <UserX size={40} strokeWidth={2} className="text-teal mx-auto mb-2" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No team members yet.</p>
            <p className="text-[14px] text-ink-muted mt-1 mb-4">
              Add a coordinator or counsellor to share client intake and support.
            </p>
            <Button variant="secondary" onClick={() => setCreateModalOpen(true)}>
              Add first team member
            </Button>
          </div>
        ) : (
          <>
            {/* Mobile: stacked list */}
            <ul className="divide-y divide-sand md:hidden">
              {initialTeam.map((member) => (
                <li key={member.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">{member.full_name}</p>
                      <div className="mt-1">{roleBadge(member)}</div>
                      <p className="mt-1 break-all font-mono text-[13px] text-ink-soft">
                        {member.email}
                      </p>
                      <p className="mt-0.5 text-[13px] text-ink-muted">
                        Created {formatDate(member.created_at)}
                      </p>
                    </div>
                    <div className="shrink-0">{statusPill(member)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {renderActions(member)}
                  </div>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className="px-5 py-3 font-semibold">Name</th>
                    <th className="px-5 py-3 font-semibold">Role</th>
                    <th className="px-5 py-3 font-semibold">Email address</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="hidden px-5 py-3 font-semibold lg:table-cell">Created</th>
                    <th className="px-5 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {initialTeam.map((member) => (
                    <tr key={member.id} className="transition-colors hover:bg-mist/50">
                      <td className="px-5 py-3.5 font-semibold text-ink">{member.full_name}</td>
                      <td className="px-5 py-3.5">{roleBadge(member)}</td>
                      <td className="px-5 py-3.5 font-mono text-[13px] text-ink-soft">{member.email}</td>
                      <td className="px-5 py-3.5">{statusPill(member)}</td>
                      <td className="hidden whitespace-nowrap px-5 py-3.5 text-ink-muted lg:table-cell">
                        {formatDate(member.created_at)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">{renderActions(member)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {/* Add Team Member Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-40 bg-night/40 flex items-center justify-center p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-team-member-title"
            className="max-w-120 w-full p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h2
                id="create-team-member-title"
                className="text-[22px] leading-[1.3] font-semibold text-teal m-0"
              >
                New team member
              </h2>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className={closeButtonClasses}
                aria-label="Close"
              >
                <X size={18} strokeWidth={2} aria-hidden />
              </button>
            </div>

            {state?.error && (
              <Notice
                variant="error"
                role="alert"
                icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
                className="mb-4"
              >
                {state.error}
              </Notice>
            )}

            <form action={formAction} className="space-y-4">
              <div>
                <label htmlFor="fullName" className={labelClasses}>
                  Full name {requiredMark}
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  required
                  placeholder="e.g. Rahul Verma"
                  className={inputClasses}
                />
              </div>

              <div>
                <label htmlFor="role" className={labelClasses}>
                  Role {requiredMark}
                </label>
                <select id="role" name="role" required defaultValue="" className={inputClasses}>
                  <option value="" disabled>
                    Choose one
                  </option>
                  {TEAM_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <p className={helpTextClasses}>
                  Coordinators and counsellors see the same client screens for now.
                </p>
              </div>

              <div>
                <label htmlFor="email" className={labelClasses}>
                  Email address {requiredMark}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="name@example.com"
                  className={inputClasses}
                />
              </div>

              <div>
                <label htmlFor="password" className={labelClasses}>
                  Initial password (min 8 characters) {requiredMark}
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  placeholder="••••••••••••"
                  className={inputClasses}
                />
                <p className={helpTextClasses}>
                  Share this password securely with the team member. They can change it after
                  login.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
                <Button variant="secondary" onClick={() => setCreateModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={isPending} loadingText="Adding...">
                  Add team member
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetModalId && (
        <div className="fixed inset-0 z-40 bg-night/40 flex items-center justify-center p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-password-title"
            className="max-w-105 w-full p-6"
          >
            <h2
              id="reset-password-title"
              className="text-[22px] leading-[1.3] font-semibold text-teal mb-2"
            >
              Reset password
            </h2>
            <p className="text-[14px] text-ink-soft mb-4">
              Enter a new temporary password for this team member.
            </p>

            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label htmlFor="newPassword" className={labelClasses}>
                  New password (min 8 characters)
                </label>
                <input
                  id="newPassword"
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className={inputClasses}
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setResetModalId(null);
                    setNewPassword('');
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={resetting} loadingText="Updating...">
                  Set password
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
