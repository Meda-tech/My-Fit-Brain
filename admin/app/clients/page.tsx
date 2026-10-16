import Link from 'next/link';
import { UserPlus, Search, SearchX, ChevronRight, MapPin } from 'lucide-react';
import { requireStaff } from '../../lib/auth';
import { AdminShell } from '../../components/AdminShell';
import { PageHeader } from '../../components/PageHeader';
import { ClientStatusPill } from '../../components/ClientStatusPill';
import { listClients } from '../../lib/services/clients';
import { formatDisplayPhone } from '../../lib/phone';
import { Button, ButtonLink, Card, inputClasses } from '../../components/brand';

export const dynamic = 'force-dynamic';

interface ClientsPageProps {
  searchParams: Promise<{
    search?: string;
  }>;
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const staff = await requireStaff();
  const { profile } = staff;
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams?.search || '';

  const clients = await listClients(searchQuery);

  return (
    <AdminShell fullName={profile.full_name} role={profile.role}>
      <PageHeader
        title="Client records"
        description="Registered clients and their verified phone numbers."
        actions={
          <ButtonLink href="/clients/new" variant="primary">
            <UserPlus size={18} strokeWidth={2} aria-hidden />
            <span>Create client</span>
          </ButtonLink>
        }
      />

      {/* Search Bar */}
      <Card className="mb-6 p-4">
        <form method="GET" action="/clients" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={18}
              strokeWidth={2}
              aria-hidden
              className="pointer-events-none absolute left-3.5 top-3.75 text-teal"
            />
            <input
              type="text"
              name="search"
              aria-label="Search clients"
              defaultValue={searchQuery}
              placeholder="Search by name, mobile number or email"
              className={`${inputClasses} pl-10`}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="secondary" className="flex-1 sm:flex-none">
              Search
            </Button>
            {searchQuery && (
              <ButtonLink href="/clients" variant="ghost">
                Clear
              </ButtonLink>
            )}
          </div>
        </form>
      </Card>

      {/* Clients */}
      <Card className="@container overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand p-4 sm:p-5">
          <p className="text-[16px] font-semibold text-teal">
            {clients.length} {clients.length === 1 ? 'record found' : 'records found'}
          </p>
          {searchQuery && (
            <span className="text-[14px] text-ink-muted">
              Results for &ldquo;{searchQuery}&rdquo;
            </span>
          )}
        </div>

        {clients.length === 0 ? (
          <div className="p-10 text-center sm:p-12">
            <SearchX size={40} strokeWidth={2} className="mx-auto mb-2 text-teal" aria-hidden />
            <p className="text-[16px] font-medium text-ink">No client records match.</p>
            <p className="mb-4 mt-1 text-[14px] text-ink-muted">
              {searchQuery
                ? `No clients found for "${searchQuery}". Try a different name or number.`
                : 'Start by creating your first client record.'}
            </p>
            <ButtonLink href="/clients/new" variant="secondary">
              Create new client
            </ButtonLink>
          </div>
        ) : (
          <>
            {/* Mobile: stacked list */}
            <ul className="divide-y divide-sand @3xl:hidden">
              {clients.map((client) => {
                const location = [client.city, client.state].filter(Boolean).join(', ');
                return (
                  <li key={client.id}>
                    <Link
                      href={`/clients/${client.id}`}
                      className="flex items-center gap-3 p-4 transition-colors hover:bg-mist/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-ink">{client.full_name}</p>
                        <p className="mt-0.5 font-mono text-[13px] text-ink-soft">
                          {formatDisplayPhone(client.phone)}
                        </p>
                        <p className="mt-0.5 text-[13px] text-ink-muted">
                          {client.gender}, {client.age} yrs · {client.marital_status}
                        </p>
                        {location && (
                          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-muted">
                            <MapPin size={13} strokeWidth={2} aria-hidden />
                            {location}
                          </p>
                        )}
                        <div className="mt-2">
                          <ClientStatusPill linked={!!client.auth_user_id} />
                        </div>
                      </div>
                      <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-teal" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto @3xl:block">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-sand bg-cream text-[12px] uppercase tracking-[0.06em] text-ink-muted">
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Client name</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Mobile phone</th>
                    <th className="whitespace-nowrap hidden px-5 py-3 font-semibold @[60rem]:table-cell">Demographics</th>
                    <th className="whitespace-nowrap hidden px-5 py-3 font-semibold @[52rem]:table-cell">Location</th>
                    <th className="whitespace-nowrap px-5 py-3 font-semibold">Login status</th>
                    <th className="whitespace-nowrap hidden px-5 py-3 font-semibold @[70rem]:table-cell">Added by</th>
                    <th className="whitespace-nowrap px-5 py-3 text-right font-semibold">
                      <span className="sr-only">Action</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand">
                  {clients.map((client) => (
                    <tr key={client.id} className="transition-colors hover:bg-mist/50">
                      <td className="px-5 py-3.5 font-semibold text-ink">
                        <Link href={`/clients/${client.id}`} className="hover:text-teal">
                          {client.full_name}
                        </Link>
                        {client.email && (
                          <span className="block text-[13px] font-normal text-ink-muted">
                            {client.email}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono text-[13px] text-ink-soft">
                        {formatDisplayPhone(client.phone)}
                      </td>
                      <td className="hidden px-5 py-3.5 text-ink-soft @[60rem]:table-cell whitespace-nowrap">
                        {client.gender}, {client.age} yrs · {client.marital_status}
                      </td>
                      <td className="hidden px-5 py-3.5 text-ink-muted @[52rem]:table-cell whitespace-nowrap">
                        {[client.city, client.state].filter(Boolean).join(', ') || '—'}
                      </td>
                      <td className="px-5 py-3.5">
                        <ClientStatusPill linked={!!client.auth_user_id} />
                      </td>
                      <td className="hidden px-5 py-3.5 text-ink-muted @[70rem]:table-cell whitespace-nowrap">
                        {client.creator_name || 'Direct / System'}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <ButtonLink href={`/clients/${client.id}`} variant="secondary" size="sm">
                          <span>View</span>
                          <ChevronRight size={16} strokeWidth={2} aria-hidden />
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </AdminShell>
  );
}
