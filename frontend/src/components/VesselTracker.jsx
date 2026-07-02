import { useState } from 'react'
import { flagFor } from '../flags'
import './VesselTracker.css'

const SORT_OPTIONS = [
  { key: 'name',       label: 'Name' },
  { key: 'events',     label: 'Fishing events' },
  { key: 'encounters', label: 'Encounters' },
  { key: 'gaps',       label: 'AIS gaps' },
  { key: 'lastSeen',   label: 'Last seen' },
]

function sortValue(vessel, key) {
  switch (key) {
    case 'events':     return Number(vessel.fishing_event_count) || 0
    case 'encounters': return Number(vessel.encounter_count) || 0
    case 'gaps':       return Number(vessel.ais_gap_count) || 0
    case 'lastSeen':   return vessel.last_fishing_date ? new Date(vessel.last_fishing_date).getTime() : 0
    default:           return vessel.vessel_name.toLowerCase()
  }
}

function fmtDate(iso) {
  return iso
    ? new Date(iso).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'
}

function fmtAliases(aliases) {
  if (!aliases || aliases.length === 0) return null
  return aliases
    .map(a => {
      const from = a.active_from ? new Date(a.active_from).getFullYear() : null
      const to   = a.active_to ? new Date(a.active_to).getFullYear() : (from ? 'present' : null)
      return from ? `${a.name} (${from}–${to})` : a.name
    })
    .join(', ')
}

function VesselRow({ vessel, included, onToggleInclude, onViewDetail }) {
  const hasGfw = !!vessel.gfw_vessel_id
  const aliasText = fmtAliases(vessel.aliases)

  return (
    <tr
      className={`tracker-row ${!hasGfw ? 'tracker-row--untracked' : ''}`}
      onClick={() => hasGfw && onViewDetail(vessel)}
    >
      <td className="tracker-cell-check" onClick={e => e.stopPropagation()}>
        {hasGfw && (
          <input
            type="checkbox"
            className="tracker-include-checkbox"
            checked={included}
            onChange={() => onToggleInclude(vessel.id)}
            title={included ? 'Tracked' : 'Not tracked'}
          />
        )}
      </td>
      <td className="tracker-cell-vessel">
        <div className="tracker-vessel-inner">
          <span className="tracker-name">{vessel.vessel_name}</span>
          {!hasGfw && <span className="no-gfw-badge">no GFW match</span>}
        </div>
      </td>
      <td className="tracker-cell-country">
        <div className="tracker-country-inner">
          <span className="tracker-flag">{flagFor(vessel.flag)}</span>
          <span className="tracker-country-name">{vessel.flag}</span>
        </div>
      </td>
      <td className="tracker-cell-aliases" title={aliasText || ''}>
        {aliasText ? `aka ${aliasText}` : '—'}
      </td>
      {hasGfw ? (
        <>
          <td className="tracker-cell-num">{Number(vessel.fishing_event_count).toLocaleString()}</td>
          <td className="tracker-cell-num">{vessel.encounter_count}</td>
          <td className="tracker-cell-num">{vessel.ais_gap_count}</td>
          <td className="tracker-cell-date">{fmtDate(vessel.last_fishing_date)}</td>
        </>
      ) : (
        <td className="tracker-cell-num tracker-cell-muted" colSpan={4}>No GFW tracking data available</td>
      )}
    </tr>
  )
}

export default function VesselTracker({ vessels, includedIds, onToggleInclude, onSetIncluded, onViewDetail }) {
  const [query, setQuery]     = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState(1) // 1 = asc, -1 = desc

  const q = query.trim().toLowerCase()
  const matches = v => !q || v.vessel_name.toLowerCase().includes(q) || (v.flag || '').toLowerCase().includes(q)

  const sortFn = (a, b) => {
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    if (av < bv) return -1 * sortDir
    if (av > bv) return  1 * sortDir
    return 0
  }

  const tracked       = vessels.filter(v => v.gfw_vessel_id && matches(v)).sort(sortFn)
  const untracked     = vessels.filter(v => !v.gfw_vessel_id && matches(v)).sort(sortFn)
  const totalTracked  = vessels.filter(v => v.gfw_vessel_id).length

  const toggleSortDir = () => setSortDir(d => -d)

  return (
    <div className="tracker-page">
      <div className="tracker-header">
        <span className="tracker-title">Vessel Tracker</span>
        <span className="tracker-count">{includedIds.size} / {totalTracked} tracked</span>
      </div>

      <div className="tracker-toolbar">
        <input
          type="text"
          className="tracker-search"
          placeholder="Search vessels…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select
          className="tracker-sort-select"
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          title="Sort by"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button
          className="tracker-sort-dir"
          onClick={toggleSortDir}
          title={sortDir === 1 ? 'Ascending' : 'Descending'}
        >
          {sortDir === 1 ? '↑' : '↓'}
        </button>
        <div className="tracker-toolbar-spacer" />
        <button className="tracker-link-btn" onClick={() => onSetIncluded(tracked.map(v => v.id))}>Select all</button>
        <button className="tracker-link-btn" onClick={() => onSetIncluded([])}>Select none</button>
      </div>

      <div className="tracker-scroll">
        {tracked.length === 0 && untracked.length === 0 ? (
          <div className="tracker-empty">No vessels match "{query}"</div>
        ) : (
          <table className="tracker-table">
            <thead>
              <tr>
                <th className="tracker-cell-check">Track</th>
                <th>Vessel</th>
                <th>Country</th>
                <th>Aliases</th>
                <th className="tracker-cell-num">⚓ Fishing Events</th>
                <th className="tracker-cell-num">🤝 Encounters</th>
                <th className="tracker-cell-num">📡 AIS Gaps</th>
                <th className="tracker-cell-date">Last Fishing Event</th>
              </tr>
            </thead>
            <tbody>
              {tracked.map(v => (
                <VesselRow
                  key={v.id}
                  vessel={v}
                  included={includedIds.has(v.id)}
                  onToggleInclude={onToggleInclude}
                  onViewDetail={onViewDetail}
                />
              ))}
              {untracked.length > 0 && (
                <>
                  <tr className="tracker-divider-row">
                    <td colSpan={8}>No GFW match ({untracked.length})</td>
                  </tr>
                  {untracked.map(v => (
                    <VesselRow key={v.id} vessel={v} included={false} onToggleInclude={() => {}} onViewDetail={() => {}} />
                  ))}
                </>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
