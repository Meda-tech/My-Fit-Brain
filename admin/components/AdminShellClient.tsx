'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { StaffRole } from '../lib/types';
import { ROLE_LABELS } from '../lib/roles';
import { Footer, Logo, cn } from './brand';
import { SIDEBAR_COOKIE } from './sidebar-cookie';

interface AdminShellClientProps {
  fullName: string;
  role: StaffRole;
  initialCollapsed: boolean;
  children: React.ReactNode;
}

// Fixed geometry: the panel is always 264px wide and the aside clips it to 80px when collapsed.
// Every icon sits on the same 40px centre line in both states, so only the labels fade.
const RAIL = 80;
const FULL = 264;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return (first + last).toUpperCase();
}

type Tip = { label: string; top: number } | null;

export function AdminShellClient({
  fullName,
  role,
  initialCollapsed,
  children,
}: AdminShellClientProps) {
  const pathname = usePathname();
  const isSuperAdmin = role === 'super_admin';
  const roleLabel = ROLE_LABELS[role];

  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [tip, setTip] = useState<Tip>(null);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    setTip(null);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=31536000; samesite=lax`;
  };

  // The drawer counts as open only on the page where it was opened, so navigating closes it.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const mobileOpen = openedOn === pathname;

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenedOn(null);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/clients', label: 'Clients', icon: Users },
    { href: '/question-bank', label: 'Question bank', icon: BookOpen },
    ...(isSuperAdmin ? [{ href: '/coordinators', label: 'Team', icon: ShieldCheck }] : []),
  ];

  // Tooltip for the collapsed rail: one fixed element beside the hovered/focused item.
  const tipHandlers = (label: string, enabled: boolean) =>
    enabled
      ? {
          onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
            setTip({ label, top: e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2 }),
          onMouseLeave: () => setTip(null),
          onFocus: (e: React.FocusEvent<HTMLElement>) =>
            setTip({ label, top: e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2 }),
          onBlur: () => setTip(null),
        }
      : {};

  const itemBase =
    'flex h-11 w-full items-center gap-3 rounded-input pl-[18px] pr-3 text-[15px] font-medium transition-colors';

  // `rail` = desktop collapsed. Labels stay in the DOM and fade, so nothing re-flows.
  const renderPanel = (rail: boolean) => {
    const labelClass = cn(
      'whitespace-nowrap transition-opacity duration-200',
      rail ? 'opacity-0' : 'opacity-100'
    );
    return (
      <div className="flex h-full w-[264px] flex-col bg-night text-white">
        {/* Brand */}
        <div className="relative h-16 shrink-0 border-b border-white/10">
          <Link
            href="/dashboard"
            aria-label="My Fit Brain staff home"
            {...tipHandlers('Dashboard', rail)}
            className="absolute inset-0 flex items-center"
          >
            <span
              className={cn(
                'absolute left-[20px] transition-opacity duration-200',
                rail ? 'opacity-100' : 'pointer-events-none opacity-0'
              )}
            >
              <Logo variant="icon" tone="reverse" width={40} />
            </span>
            <span
              className={cn(
                'absolute left-[16px] transition-opacity duration-200',
                rail ? 'pointer-events-none opacity-0' : 'opacity-100'
              )}
            >
              <Logo variant="horizontal" tone="reverse" width={140} />
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav aria-label="Main administration" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          <p
            className={cn(
              'h-8 pl-[18px] pt-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-mist/80',
              labelClass
            )}
            aria-hidden={rail}
          >
            Menu
          </p>
          <ul className="space-y-1">
            {navItems.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-label={rail ? label : undefined}
                    aria-current={active ? 'page' : undefined}
                    {...tipHandlers(label, rail)}
                    className={cn(
                      itemBase,
                      active ? 'bg-mist font-semibold text-teal' : 'text-white hover:bg-white/10'
                    )}
                  >
                    <Icon size={20} strokeWidth={2} aria-hidden className="shrink-0" />
                    <span className={labelClass}>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* User, sign out, collapse */}
        <div className="shrink-0 space-y-1 border-t border-white/10 px-3 py-3">
          <div
            tabIndex={rail ? 0 : -1}
            {...tipHandlers(`${fullName} · ${roleLabel}`, rail)}
            className="flex h-14 items-center gap-3 rounded-input pl-2 pr-3 outline-offset-2"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mist font-heading text-[14px] font-semibold text-teal"
            >
              {initials(fullName)}
            </span>
            <div className={cn('min-w-0', labelClass)}>
              <p className="truncate text-[14px] font-semibold text-white">{fullName}</p>
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-mist">{roleLabel}</p>
            </div>
          </div>

          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              aria-label={rail ? 'Sign out' : undefined}
              {...tipHandlers('Sign out', rail)}
              className={cn(itemBase, 'text-white hover:bg-white/10')}
            >
              <LogOut size={20} strokeWidth={2} aria-hidden className="shrink-0" />
              <span className={labelClass}>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-cream">
      {/* Desktop sidebar */}
      <aside
        style={{ width: collapsed ? RAIL : FULL }}
        className="fixed inset-y-0 left-0 z-30 hidden overflow-hidden transition-[width] duration-200 ease-out lg:block"
      >
        {renderPanel(collapsed)}
      </aside>

      {/* Collapse handle on the sidebar edge, always in the same place */}
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        aria-expanded={!collapsed}
        {...tipHandlers(collapsed ? 'Expand menu' : 'Collapse menu', true)}
        style={{ left: (collapsed ? RAIL : FULL) - 14 }}
        className="fixed top-[50px] z-40 hidden h-7 w-7 items-center justify-center rounded-full border border-sand bg-white text-teal shadow-card transition-[left,background-color] duration-200 ease-out hover:bg-mist lg:flex"
      >
        {collapsed ? (
          <PanelLeftOpen size={15} strokeWidth={2} aria-hidden />
        ) : (
          <PanelLeftClose size={15} strokeWidth={2} aria-hidden />
        )}
      </button>

      {/* Rail tooltip */}
      {tip && (
        <div
          role="tooltip"
          style={{ top: tip.top, left: (collapsed ? RAIL : FULL) + 14 }}
          className="pointer-events-none fixed z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-input bg-ink px-3 py-1.5 text-[13px] font-medium text-white shadow-card lg:block"
        >
          {tip.label}
        </div>
      )}

      {/* Mobile top bar */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between bg-night px-2 lg:hidden">
        <button
          type="button"
          onClick={() => setOpenedOn(pathname)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          aria-controls="admin-mobile-drawer"
          className="flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10"
        >
          <Menu size={22} strokeWidth={2} aria-hidden />
        </button>
        <Link href="/dashboard" aria-label="My Fit Brain staff home">
          <Logo variant="horizontal" tone="reverse" width={120} />
        </Link>
        <span
          aria-hidden
          className="mr-1 flex h-9 w-9 items-center justify-center rounded-full bg-mist font-heading text-[13px] font-semibold text-teal"
        >
          {initials(fullName)}
        </span>
      </header>

      {/* Mobile drawer */}
      <div
        className={cn('fixed inset-0 z-40 lg:hidden', mobileOpen ? '' : 'pointer-events-none')}
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
      >
        <div
          onClick={() => setOpenedOn(null)}
          className={cn(
            'absolute inset-0 bg-night/50 transition-opacity duration-200',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
        />
        <div
          id="admin-mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={cn(
            'absolute inset-y-0 left-0 w-[264px] max-w-[85vw] overflow-hidden shadow-card transition-transform duration-200 ease-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {renderPanel(false)}
          <button
            type="button"
            onClick={() => setOpenedOn(null)}
            aria-label="Close menu"
            className="absolute right-2 top-2.5 flex h-11 w-11 items-center justify-center rounded-full text-white hover:bg-white/10"
          >
            <X size={22} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          'flex min-h-screen min-w-0 flex-col overflow-x-clip transition-[padding] duration-200 ease-out',
          collapsed ? 'lg:pl-[80px]' : 'lg:pl-[264px]'
        )}
      >
        <main className="mx-auto w-full min-w-0 max-w-[1200px] flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}
