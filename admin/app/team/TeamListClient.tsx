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
  moveClientsAction,
  resetPasswordAction,
  TeamActionState,
} from './actions';
import {
  Button,
  Card,
  Notice,
  Pill,
  cn,
  helpTextClasses,
  inputClasses,
  labelClasses,
} from '../../components/brand';

interface TeamListClientProps {
  initialTeam: Profile[];
  /** How many clients each coordinator, counsellor and CRM has. */
  clientCounts: Record<string, number>;
}

const requiredMark = (
  <span className="text-coral-deep" aria-hidden>
    *
  </span>
);

// The Team list columns: name (flexible) · role · status · on wide screens three button slots.
const TEAM_GRID = 'sm:grid-cols-[minmax(0,1fr)_11rem_8rem] sm:items-center sm:gap-x-6 2xl:grid-cols-[minmax(0,1fr)_11rem_8rem_28rem]';

const closeButtonClasses =
  'inline-flex items-center justify-center w-11 h-11 -mr-2 rounded-full text-ink-muted hover:bg-mist hover:text-teal transition-colors';

export function TeamListClient({ initialTeam, clientCounts }: TeamListClientProps) {
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [resetModalId, setResetModalId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [statusTogglingId, setStatusTogglingId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [moveFrom, setMoveFrom] = useState<Profile | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [moving, setMoving] = useState(false);
  const [clashes, setClashes] = useState<string[] | null>(null);

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
      setErrorMessage(null);
      const res = await toggleStatusAction(member.id, !member.is_active);
      if (!res.success) {
        setToastMessage(null);
        setErrorMessage(
          res.error === 'Move their clients first.'
            ? `${member.full_name} still has clients. Move their clients first.`
            : res.error || 'Failed to update status'
        );
      } else {
        setToastMessage(
          `${ROLE_LABELS[member.role]} ${member.full_name} marked as ${!member.is_active ? 'active' : 'inactive'}.`
        );
      }
    } finally {
      setStatusTogglingId(null);
    }
  };

  const moveRole = moveFrom?.role === 'counsellor' ? 'counsellor' : moveFrom?.role === 'crm' ? 'crm' : 'coordinator';
  const moveRoleWord = moveRole === 'crm' ? 'CRM' : moveRole;
  // Who can take the clients: active, the same role, and not the one they come from.
  const moveTargets = moveFrom
    ? initialTeam.filter((m) => m.role === moveFrom.role && m.is_active && m.id !== moveFrom.id)
    : [];

  const handleMoveClients = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moveFrom || !moveTo) return;
    try {
      setMoving(true);
      const res = await moveClientsAction(moveFrom.id, moveTo, moveRole);
      if (!res.success && res.clashes?.length) {
        // Nothing moved: keep the dialog open with the clashing presentations, so another counsellor can be picked.
        setClashes(res.clashes);
        return;
      }
      if (!res.success) {
        setErrorMessage(res.error || 'The clients could not be moved.');
      } else {
        setErrorMessage(null);
        setToastMessage(res.message || 'Clients moved.');
      }
      setMoveFrom(null);
      setMoveTo('');
    } finally {
      setMoving(false);
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

  const clientsOf = (member: Profile) =>
    member.role === 'coordinator' || member.role === 'counsellor' || member.role === 'crm' ? clientCounts[member.id] ?? 0 : null;

  const roleBadge = (member: Profile) => {
    const clients = clientsOf(member);
    return (
      <>
        <Pill className="whitespace-nowrap">{ROLE_LABELS[member.role]}</Pill>
        {clients !== null && (
          <span className="mt-1 block text-[13px] text-ink-muted">
            {clients} {clients === 1 ? 'client' : 'clients'}
          </span>
        )}
      </>
    );
  };

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

  // Always in the same order. On wide screens each button has its own slot (an empty slot keeps the columns).
  const renderActions = (member: Profile) => (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => handleToggleStatus(member)}
        disabled={statusTogglingId === member.id}
        className="2xl:w-full"
      >
        {member.is_active ? 'Make inactive' : 'Make active'}
      </Button>
      {(clientsOf(member) ?? 0) > 0 ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setErrorMessage(null);
            setMoveTo('');
            setClashes(null);
            setMoveFrom(member);
          }}
          className="2xl:w-full"
        >
          Move clients
        </Button>
      ) : (
        <span aria-hidden className="hidden 2xl:block" />
      )}
      <Button variant="ghost" size="sm" onClick={() => setResetModalId(member.id)} className="2xl:w-full">
        Reset password
      </Button>
    </>
  );

  return (
    <div>
      {errorMessage && (
        <Notice
          variant="error"
          role="alert"
          icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
          className="mb-5"
        >
          <div className="flex items-center justify-between gap-3">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className={closeButtonClasses}
              aria-label="Dismiss message"
            >
              <X size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </Notice>
      )}

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
        description="Create and manage coordinator, counsellor and CRM accounts and their access."
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
              Add a coordinator, counsellor or CRM to share client intake and support.
            </p>
            <Button variant="secondary" onClick={() => setCreateModalOpen(true)}>
              Add first team member
            </Button>
          </div>
        ) : (
          // One list for every width, with the same columns in every row. Phones: everything stacked. Tablets and
          // laptops: name · role · status in columns, the buttons on their own line below. Wide screens: the
          // buttons in a fourth column with fixed slots, so each kind of button lines up from row to row.
          <div>
            <div className={cn(TEAM_GRID, 'hidden bg-cream px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted sm:grid')}>
              <span>Name</span>
              <span>Role</span>
              <span>Status</span>
              <span className="hidden 2xl:block">Actions</span>
            </div>
            <ul className="divide-y divide-sand border-t border-sand">
              {initialTeam.map((member) => (
                <li key={member.id} className={cn(TEAM_GRID, 'grid gap-3 p-4 transition-colors hover:bg-mist/50 sm:px-5')}>
                  <div className="min-w-0">
                    <p className="m-0 font-semibold text-ink">{member.full_name}</p>
                    <p className="m-0 break-all font-mono text-[13px] text-ink-soft">{member.email}</p>
                    <p className="m-0 text-[13px] text-ink-muted">Created {formatDate(member.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 sm:block">
                    {roleBadge(member)}
                    <span className="sm:hidden">{statusPill(member)}</span>
                  </div>
                  <div className="hidden sm:block">{statusPill(member)}</div>
                  <div className="flex flex-wrap items-center gap-2 sm:col-span-3 2xl:col-span-1 2xl:grid 2xl:grid-cols-3 [&>*]:whitespace-nowrap">
                    {renderActions(member)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
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
                  Coordinators work on purchases and calls, counsellors on reports and presentations, CRM on started packages only.
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

      {/* Move clients Modal */}
      {moveFrom && (
        <div className="fixed inset-0 z-40 bg-night/40 flex items-center justify-center p-4">
          <Card
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-clients-title"
            className="max-w-105 w-full max-h-[90dvh] overflow-y-auto p-6"
          >
            <h2 id="move-clients-title" className="text-[22px] leading-[1.3] font-semibold text-teal mb-2">
              Move clients
            </h2>
            <p className="text-[14px] text-ink-soft mb-4">
              {moveFrom.role === 'counsellor'
                ? `All ${clientsOf(moveFrom)} clients of ${moveFrom.full_name} go to the counsellor you choose, with their upcoming presentations at the same date and time. ${moveFrom.full_name} no longer sees them. Past presentations stay with ${moveFrom.full_name}.`
                : moveFrom.role === 'crm'
                  ? `All ${clientsOf(moveFrom)} clients of ${moveFrom.full_name}, with their packages, go to the CRM you choose. ${moveFrom.full_name} no longer sees them.`
                  : `All ${clientsOf(moveFrom)} clients of ${moveFrom.full_name}, with their purchases, go to the coordinator you choose.`}
            </p>

            {moveTargets.length === 0 ? (
              <>
                <p className="text-[14px] text-ink mb-4">
                  There is no other active {moveRoleWord}. Add one first.
                </p>
                <div className="flex justify-end">
                  <Button variant="secondary" onClick={() => setMoveFrom(null)}>
                    Close
                  </Button>
                </div>
              </>
            ) : (
              <form onSubmit={handleMoveClients} className="space-y-4">
                <div>
                  <label htmlFor="moveTo" className={labelClasses}>
                    New {moveRoleWord} {requiredMark}
                  </label>
                  <select
                    id="moveTo"
                    required
                    value={moveTo}
                    onChange={(e) => {
                      setMoveTo(e.target.value);
                      setClashes(null);
                    }}
                    className={inputClasses}
                  >
                    <option value="" disabled>
                      Choose one
                    </option>
                    {moveTargets.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} ({clientsOf(m)} {clientsOf(m) === 1 ? 'client' : 'clients'})
                      </option>
                    ))}
                  </select>
                </div>

                {clashes && clashes.length > 0 && (
                  <Notice
                    variant="error"
                    role="alert"
                    icon={<AlertCircle size={18} strokeWidth={2} className="text-coral-deep" />}
                  >
                    <p className="m-0 font-medium">
                      {moveTargets.find((m) => m.id === moveTo)?.full_name ?? 'This counsellor'} is not free at these
                      times. Nothing was moved. Pick another counsellor.
                    </p>
                    <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-[14px]">
                      {clashes.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </Notice>
                )}

                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <Button variant="secondary" onClick={() => setMoveFrom(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" loading={moving} loadingText="Moving..." disabled={!!clashes?.length}>
                    Move clients
                  </Button>
                </div>
              </form>
            )}
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
