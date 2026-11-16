/**
 * Control Tower: answer MControlProgram approval requests from inside Hermes Desktop.
 *
 * Agents' gated tool calls (SSH commands, URLs, MCP tools held for "ask") reach you without leaving Hermes.
 *
 * Polls MControlProgram's API-key API (`/api/v1/approvals`) with a key that has the `approvals`
 * permission; MControlProgram's Settings → Approval channel must be "API keys".
 * Disk plugin: plain ESM, no build step, only the SDK + react imports the loader allows.
 */
import {
  atom, host, useValue, pluginSettingsHref, relativeTime,
  Badge, Button, EmptyState, Input, ListRow, StatusDot, Tip, ToggleRow,
  PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA, STATUSBAR_AREAS
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'control-tower'
const PAGE = '/control-tower'
const DEFAULTS = { url: 'http://127.0.0.1:7700', key: '', pollSec: 5, notify: true }

// ---- helpers ----

/** `http://host:7700/` → `http://host:7700/api/v1` */
const apiBase = url => `${String(url).trim().replace(/\/+$/, '')}/api/v1`

/** Ids in `pending` that were not in `seen`: the asks to notify about. */
const newIds = (pending, seen) => pending.map(a => a.id).filter(id => !seen.has(id))

/** One line for a notification / row: what, by whom. */
const describe = a => `${a.summary || a.tool} — ${a.principal}`

// ---- plugin ----

export default {
  id: ID,
  name: 'Control Tower',
  description: 'Allow or deny MControlProgram approval requests from Hermes Desktop.',
  register(ctx) {
    const prefs = atom({ ...DEFAULTS, ...ctx.storage.get('prefs', {}) })
    // first run: persist, so values a local install was seeded with (DEFAULTS edited in its plugin.js) survive updates
    if (!ctx.storage.get('prefs', null)) ctx.storage.set('prefs', prefs.get())
    // status: 'setup' (no key) | 'ok' | 'error'
    const state = atom({ status: 'setup', error: '', pending: [], recent: [], channel: '', busy: {} })
    const patchState = p => state.set({ ...state.get(), ...p })
    let seen = null // ids already notified; null until the first poll so existing asks don't all pop at startup

    const call = async (path, method = 'GET') => {
      const { url, key } = prefs.get()
      const res = await fetch(apiBase(url) + path, { method, headers: { authorization: `Bearer ${key}` } })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
      return body
    }

    const notify = a => {
      if (!prefs.get().notify) return
      ctx.os.notify({
        title: 'MControlProgram approval needed',
        body: [describe(a), a.reason && `(${a.reason})`].filter(Boolean).join(' '),
        activate: PAGE,
        actions: [
          { id: 'allow', label: 'Allow once', onAction: () => void decide(a.id, 'approved') },
          { id: 'deny', label: 'Deny', onAction: () => void decide(a.id, 'denied') }
        ]
      })
    }

    const poll = async () => {
      if (!prefs.get().key) { patchState({ status: 'setup', error: '', pending: [], recent: [] }); return }
      try {
        const { pending, recent } = await call('/approvals')
        if (seen) for (const id of newIds(pending, seen)) notify(pending.find(a => a.id === id))
        seen = new Set(pending.map(a => a.id))
        patchState({ status: 'ok', error: '', pending, recent })
      } catch (e) {
        patchState({ status: 'error', error: e.message || String(e) })
      }
    }

    async function decide(id, decision) {
      patchState({ busy: { ...state.get().busy, [id]: true } })
      try { await call(`/approvals/${encodeURIComponent(id)}/${decision}`, 'POST') }
      catch (e) { host.notifyError(e, 'Control Tower: could not send the decision') }
      finally {
        const { [id]: _, ...busy } = state.get().busy
        patchState({ busy })
        await poll()
      }
    }

    let stopPoll = () => {}
    const schedule = () => {
      stopPoll()
      stopPoll = ctx.setInterval(() => void poll(), Math.max(2, Number(prefs.get().pollSec) || DEFAULTS.pollSec) * 1000)
      void poll()
    }
    const update = p => {
      prefs.set({ ...prefs.get(), ...p })
      ctx.storage.set('prefs', prefs.get())
      if ('url' in p || 'key' in p) seen = null
      schedule()
    }
    schedule()

    // ---- UI ----

    const muted = 'text-(--ui-text-tertiary)'

    function ApprovalRow({ a }) {
      const { busy } = useValue(state)
      const args = JSON.stringify(a.args ?? {}, null, 2)
      return jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded-md p-3 shadow-[inset_0_0_0_1px_var(--ui-stroke-secondary)]',
        children: [
          jsx('div', { className: 'font-mono text-sm break-all', children: a.summary || a.tool }),
          jsx('div', {
            className: `text-xs ${muted}`,
            children: [a.principal, a.instance_name, a.reason, relativeTime(a.created_at), a.attempts > 1 && `${a.attempts} attempts`].filter(Boolean).join(' · ')
          }),
          args !== '{}' && jsxs('details', {
            className: 'text-xs',
            children: [
              jsx('summary', { className: `cursor-pointer ${muted}`, children: 'Arguments' }),
              jsx('pre', { className: 'mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono', children: args })
            ]
          }),
          jsxs('div', {
            className: 'flex gap-2 pt-1',
            children: [
              jsx(Button, { size: 'sm', disabled: !!busy[a.id], onClick: () => void decide(a.id, 'approved'), children: 'Allow once' }),
              jsx(Button, { size: 'sm', variant: 'outline', disabled: !!busy[a.id], onClick: () => void decide(a.id, 'denied'), children: 'Deny once' })
            ]
          })
        ]
      })
    }

    function Page() {
      const s = useValue(state)
      const { url } = useValue(prefs)
      const toSettings = jsx(Button, { size: 'sm', variant: 'secondary', onClick: () => host.navigate(pluginSettingsHref(ID)), children: 'Settings' })
      return jsxs('div', {
        className: 'mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto p-5',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('div', { className: 'text-base font-medium', children: 'Control Tower' }),
              jsx(StatusDot, { tone: s.status === 'ok' ? 'good' : s.status === 'error' ? 'bad' : 'muted' }),
              jsx('div', { className: `flex-1 truncate text-xs ${muted}`, children: s.status === 'error' ? s.error : url }),
              toSettings
            ]
          }),
          s.status === 'setup' && jsx(EmptyState, { title: 'Not connected', description: 'Add your MControlProgram URL and an API key with the approvals permission in Settings.' }),
          s.status !== 'setup' && s.pending.length === 0 && jsx(EmptyState, { title: 'Nothing waiting', description: 'Gated tool calls from your agents show up here.' }),
          ...s.pending.map(a => jsx(ApprovalRow, { a }, a.id)),
          s.recent.length > 0 && jsxs('div', {
            className: 'flex flex-col gap-1 pt-2',
            children: [
              jsx('div', { className: `text-xs font-medium ${muted}`, children: 'Recent' }),
              ...s.recent.slice(0, 10).map(a => jsxs('div', {
                className: 'flex items-center gap-2 text-xs',
                children: [
                  jsx(Badge, { variant: a.status === 'denied' ? 'destructive' : a.status === 'expired' ? 'muted' : 'success', children: a.status === 'used' ? 'allowed' : a.status }),
                  jsx('span', { className: 'truncate font-mono', children: a.summary || a.tool }),
                  jsx('span', { className: `ml-auto shrink-0 ${muted}`, children: [a.decided_by, a.decided_at && relativeTime(a.decided_at)].filter(Boolean).join(' · ') })
                ]
              }, a.id))
            ]
          })
        ]
      })
    }

    function Chip() {
      const s = useValue(state)
      if (s.status === 'setup') return null
      const n = s.pending.length
      return jsx(Tip, {
        label: s.status === 'error' ? `Control Tower: ${s.error}` : n ? `${n} MControlProgram approval${n > 1 ? 's' : ''} waiting` : 'No MControlProgram approvals waiting',
        children: jsxs('button', {
          type: 'button',
          className: `inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] ${n ? 'text-(--ui-text-primary)' : muted}`,
          onClick: () => host.navigate(PAGE),
          children: [jsx(StatusDot, { tone: s.status === 'error' ? 'bad' : n ? 'warn' : 'good' }), n ? `${n} to approve` : 'Approvals']
        })
      })
    }

    function Settings() {
      const p = useValue(prefs)
      const s = useValue(state)
      return jsxs('div', {
        children: [
          jsx(ListRow, {
            title: 'MControlProgram URL',
            description: 'The admin UI address, e.g. http://127.0.0.1:7700.',
            action: jsx(Input, { value: p.url, placeholder: DEFAULTS.url, onChange: e => update({ url: e.target.value }) })
          }),
          jsx(ListRow, {
            title: 'API key',
            description: 'MControlProgram → Settings → API keys, with the approvals permission. Stored in this app\'s local storage.',
            action: jsx(Input, { type: 'password', value: p.key, placeholder: 'mcpk_…', onChange: e => update({ key: e.target.value.trim() }) })
          }),
          jsx(ListRow, {
            title: 'Poll every (seconds)',
            description: 'How often to check for new requests.',
            action: jsx(Input, { type: 'number', min: 2, value: p.pollSec, onChange: e => update({ pollSec: Number(e.target.value) }) })
          }),
          jsx(ToggleRow, {
            label: 'Desktop notifications',
            description: 'Notify, with Allow / Deny buttons, when a new request arrives.',
            checked: p.notify,
            onChange: on => update({ notify: on })
          }),
          jsx(ListRow, {
            title: 'Connection',
            description: s.status === 'ok' ? `Connected: ${s.pending.length} waiting.` : s.status === 'error' ? s.error : 'Not configured.',
            action: jsx(Button, {
              size: 'sm', variant: 'secondary',
              onClick: async () => {
                try { const me = await call('/me'); host.notify({ kind: 'info', message: `Connected as API key "${me.name}" (approval channel: ${me.approvalChannel})` }) }
                catch (e) { host.notifyError(e, 'Control Tower: connection failed') }
                await poll()
              },
              children: 'Test connection'
            })
          })
        ]
      })
    }

    ctx.registerMany([
      { id: 'page', area: ROUTES_AREA, data: { path: PAGE }, render: () => jsx(Page, {}) },
      { id: 'nav', area: SIDEBAR_NAV_AREA, data: { path: PAGE, label: 'Approvals', codicon: 'shield' } },
      { id: 'chip', area: STATUSBAR_AREAS.right, order: 125, render: () => jsx(Chip, {}) },
      { id: 'open', area: PALETTE_AREA, data: { id: 'open', label: 'Control Tower: Show MControlProgram approvals', keywords: ['approve', 'deny', 'mcontrolprogram'], run: () => host.navigate(PAGE) } }
    ])
    ctx.registerSettingsPage?.({ id: 'settings', title: 'Control Tower', icon: 'shield', render: () => jsx(Settings, {}) })
  }
}
