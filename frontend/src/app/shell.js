// What every page shares: the header (navigation, notification bell, account menu), the
// footer, and startPage(), which loads the signed-in user and enforces who may see a page.

import '@fontsource-variable/atkinson-hyperlegible-next';
import '@fontsource-variable/bricolage-grotesque';
import '../styles.css';

import { company } from '../../shared/company.js';
import { h, icon, uid } from '../lib/dom.js';
import { getApi } from './api.js';
import { timeAgo } from './format.js';
import { showFlash, showToast } from './ui.js';

const POLL_MS = 60_000;

export const homeFor = (user) => (user?.role === 'employer' ? 'employer.html' : user?.role === 'seeker' ? 'jobs.html' : 'index.html');

const NAV = {
  guest: [
    { key: 'jobs', href: 'jobs.html', label: 'Find jobs' },
    { key: 'employers', href: 'index.html#employers', label: 'For employers' },
  ],
  seeker: [
    { key: 'jobs', href: 'jobs.html', label: 'Jobs for you' },
    { key: 'applications', href: 'applications.html', label: 'Applications' },
    { key: 'profile', href: 'profile.html', label: 'Profile' },
  ],
  employer: [
    { key: 'dashboard', href: 'employer.html', label: 'Dashboard' },
    { key: 'post', href: 'employer-job.html', label: 'Post a job' },
  ],
};

/**
 * Call once per page. require: 'seeker' | 'employer' | 'any' to restrict the page.
 * Returns { api, user } (user is null for visitors).
 */
export async function startPage({ active = null, require = null } = {}) {
  const api = await getApi({ onSlowRequest: () => showToast('Fernway’s server is waking up. This can take up to a minute the first time.') });
  let user = null;
  try {
    user = await api.auth.me();
  } catch (error) {
    if (error.status !== 401) console.error(error);
  }

  if (require && !user) {
    location.replace(`signin.html?next=${encodeURIComponent(location.pathname.replace(/^\//, '') + location.search + location.hash)}`);
    return new Promise(() => {}); // the page is leaving
  }
  if (require && require !== 'any' && user.role !== require) {
    location.replace(homeFor(user));
    return new Promise(() => {});
  }

  renderHeader({ api, user, active });
  renderFooter({ api });
  showFlash();
  return { api, user };
}

// --- Header -----------------------------------------------------------------------------

function logo(user) {
  return h(
    'a',
    { href: user ? homeFor(user) : 'index.html', class: 'flex min-h-11 items-center gap-2 font-display text-xl font-semibold tracking-tight text-ink' },
    h('span', { class: 'grid size-8 place-items-center rounded-xl bg-brand text-on-brand' }, icon('leaf', 'size-5')),
    company.name,
    h('span', { class: 'sr-only' }, ', home'),
  );
}

function navLinks(user, active) {
  return NAV[user?.role ?? 'guest'].map((item) => h('a', { class: 'nav-link', href: item.href, 'aria-current': item.key === active ? 'page' : null }, item.label));
}

/** A button that opens a panel below it; closes on Escape or a click elsewhere. */
function disclosure({ button, panel, onOpen }) {
  const wrapper = h('div', { class: 'relative' }, button, panel);
  panel.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  const close = (focusButton = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (focusButton) button.focus();
  };
  button.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    if (opening) onOpen?.();
  });
  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) close();
  });
  wrapper.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close(true);
  });
  return { wrapper, close };
}

function accountMenu(api, user) {
  const panelId = uid('account');
  const button = h(
    'button',
    { type: 'button', class: 'btn btn-ghost min-h-11 gap-2 px-3', 'aria-controls': panelId, 'aria-label': `Account menu, signed in as ${user.full_name}` },
    h('span', { class: 'grid size-8 place-items-center rounded-full bg-surface-2 text-ink' }, icon(user.role === 'employer' ? 'building' : 'user', 'size-4')),
    h('span', { class: 'hidden max-w-36 truncate lg:inline' }, user.role === 'employer' ? (user.company?.name ?? user.full_name) : user.full_name),
    h('span', { class: 'sr-only' }, 'Account menu'),
    icon('chevronDown', 'size-4'),
  );
  const panel = h(
    'div',
    { id: panelId, class: 'popover w-64 py-2' },
    h('div', { class: 'px-4 pt-1 pb-3' }, h('p', { class: 'font-semibold text-ink' }, user.full_name), h('p', { class: 'truncate text-sm text-ink-muted' }, user.email)),
    h('div', { class: 'border-t border-line pt-2' }),
    user.role === 'employer'
      ? h('a', { class: 'menu-item', href: 'employer.html#company' }, icon('building', 'size-4'), 'Company details')
      : h('a', { class: 'menu-item', href: 'profile.html' }, icon('user', 'size-4'), 'Your profile'),
    h(
      'button',
      {
        type: 'button',
        class: 'menu-item',
        onclick: async () => {
          await api.auth.logout().catch(() => null);
          location.href = 'index.html';
        },
      },
      icon('logout', 'size-4'),
      'Sign out',
    ),
  );
  return disclosure({ button, panel }).wrapper;
}

function mobileMenu(user, active) {
  const panelId = uid('menu');
  const button = h('button', { type: 'button', class: 'icon-button md:hidden', 'aria-controls': panelId, 'aria-label': 'Menu' }, icon('menu'));
  const panel = h(
    'nav',
    { id: panelId, class: 'popover right-auto left-0 grid w-60 gap-1 p-2', 'aria-label': 'Main' },
    navLinks(user, active),
    user ? null : [h('a', { class: 'nav-link', href: 'signin.html' }, 'Sign in'), h('a', { class: 'nav-link', href: 'signup.html' }, 'Create account')],
  );
  return disclosure({ button, panel }).wrapper;
}

function renderHeader({ api, user, active }) {
  const header = document.querySelector('[data-shell-header]');
  if (!header) return;
  const right = user
    ? [notificationBell(api, user), accountMenu(api, user)]
    : [h('a', { class: 'btn btn-ghost hidden sm:inline-flex', href: 'signin.html' }, 'Sign in'), h('a', { class: 'btn btn-primary', href: 'signup.html' }, 'Create account')];
  header.replaceChildren(
    h(
      'div',
      { class: 'page flex h-16 items-center gap-2' },
      mobileMenu(user, active),
      logo(user),
      h('nav', { class: 'ml-6 hidden items-center gap-1 md:flex', 'aria-label': 'Main' }, navLinks(user, active)),
      h('div', { class: 'ml-auto flex items-center gap-1 sm:gap-2' }, right),
    ),
  );
}

// --- Notifications ----------------------------------------------------------------------

function linkFor(item, user) {
  if (user.role === 'employer') return `applicant.html?id=${encodeURIComponent(item.application_id)}`;
  return `applications.html#application-${encodeURIComponent(item.application_id)}`;
}

function notificationBell(api, user) {
  const panelId = uid('notifications');
  const badge = h('span', { class: 'count-badge', hidden: true, 'aria-hidden': 'true' });
  const button = h('button', { type: 'button', class: 'icon-button', 'aria-controls': panelId, 'aria-label': 'Notifications' }, icon('bell'), badge);
  const list = h('ul', { class: 'max-h-[min(28rem,70vh)] divide-y divide-line overflow-y-auto' });
  const markAll = h('button', { type: 'button', class: 'link-button text-sm font-semibold text-brand hover:underline', hidden: true }, 'Mark all as read');
  const panel = h(
    'div',
    { id: panelId, class: 'popover' },
    h('div', { class: 'flex items-center justify-between gap-3 border-b border-line px-4 py-3' }, h('h2', { class: 'font-display text-base font-semibold' }, 'Notifications'), markAll),
    list,
  );
  // One polite status message for screen readers when new notifications arrive.
  const announcer = h('p', { class: 'sr-only', role: 'status' });
  let unread = 0;
  let items = [];

  function render() {
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    button.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    markAll.hidden = unread === 0;
    if (!items.length) {
      list.replaceChildren(
        h(
          'li',
          { class: 'grid justify-items-center gap-2 px-4 py-8 text-center text-sm text-ink-muted' },
          icon('inbox', 'size-6'),
          user.role === 'employer' ? 'You’ll see new applications here.' : 'You’ll see employers’ decisions here.',
        ),
      );
      return;
    }
    list.replaceChildren(
      ...items.map((item) =>
        h(
          'li',
          {},
          h(
            'a',
            {
              class: `flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2 ${item.read_at ? '' : 'bg-brand-soft/40'}`,
              href: linkFor(item, user),
              onclick: async (event) => {
                if (item.read_at || event.ctrlKey || event.metaKey || event.shiftKey) return;
                // Mark it read before leaving, so the request isn't cut off by the page change.
                event.preventDefault();
                await api.notifications.markRead({ ids: [item.id] }).catch(() => null);
                location.href = event.currentTarget?.href ?? linkFor(item, user);
              },
            },
            h('span', { class: `mt-2 size-2 shrink-0 rounded-full ${item.read_at ? 'bg-transparent' : 'bg-sun'}`, 'aria-hidden': 'true' }),
            h(
              'span',
              { class: 'grid gap-0.5' },
              h('span', { class: 'text-sm font-semibold text-ink' }, item.read_at ? null : h('span', { class: 'sr-only' }, 'Unread: '), item.title),
              item.body ? h('span', { class: 'text-sm text-ink-muted' }, item.body) : null,
              h('span', { class: 'text-xs text-ink-muted' }, timeAgo(item.created_at)),
            ),
          ),
        ),
      ),
    );
  }

  async function refresh({ announce = true } = {}) {
    try {
      const result = await api.notifications.list({ limit: 20 });
      if (announce && result.unread > unread) {
        const fresh = result.unread - unread;
        announcer.textContent = `${fresh} new ${fresh === 1 ? 'notification' : 'notifications'}`;
      }
      unread = result.unread;
      items = result.items;
      render();
    } catch (error) {
      if (error.status === 401) location.href = 'signin.html';
    }
  }

  markAll.addEventListener('click', async () => {
    await api.notifications.markRead({ all: true }).catch(() => null);
    await refresh({ announce: false });
  });

  const { wrapper } = disclosure({ button, panel, onOpen: () => refresh({ announce: false }) });
  wrapper.append(announcer);
  render();
  refresh({ announce: false });
  setInterval(() => document.visibilityState === 'visible' && refresh(), POLL_MS);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  window.addEventListener('focus', () => refresh());
  window.addEventListener('fernway:data-changed', () => refresh()); // demo mode: another window changed something
  return wrapper;
}

// --- Footer -----------------------------------------------------------------------------

function renderFooter({ api }) {
  const footer = document.querySelector('[data-shell-footer]');
  if (!footer) return;
  footer.replaceChildren(
    h(
      'div',
      { class: 'page grid gap-6 py-10 text-sm text-ink-muted sm:grid-cols-[1fr_auto]' },
      h(
        'div',
        { class: 'grid gap-3' },
        h('p', { class: 'flex items-center gap-2 font-display text-base font-semibold text-ink' }, icon('leaf', 'size-4 text-brand'), company.name),
        h('p', { class: 'max-w-md' }, company.fictionalNotice),
        api.mode === 'demo'
          ? h(
              'p',
              { class: 'notice-demo flex flex-wrap items-center gap-x-3 gap-y-2' },
              h('span', {}, h('strong', { class: 'text-ink' }, 'Demo mode. '), 'Accounts, jobs and applications are saved in this browser only.'),
              h(
                'button',
                {
                  type: 'button',
                  class: 'link',
                  onclick: () => {
                    if (!window.confirm('Reset the demo? This removes every account, job and application you added in this browser.')) return;
                    api.demo.reset();
                    location.href = 'index.html';
                  },
                },
                'Reset demo data',
              ),
            )
          : null,
      ),
      h(
        'nav',
        { class: 'flex flex-wrap content-start gap-x-5 gap-y-2 sm:justify-end', 'aria-label': 'Footer' },
        h('a', { class: 'hover:text-ink', href: 'jobs.html' }, 'Find jobs'),
        h('a', { class: 'hover:text-ink', href: 'signup.html?role=employer' }, 'Post a job'),
        h('a', { class: 'hover:text-ink', href: 'privacy.html' }, 'Privacy'),
        h('span', {}, `© ${new Date().getFullYear()} ${company.name}`),
      ),
    ),
  );
}
