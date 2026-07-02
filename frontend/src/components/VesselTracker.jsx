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

function VesselCard({ vessel, included, onToggleInclude, onViewDetail }) {
  const hasGfw   = !!vessel.gfw_vessel_id
  const lastSeen = vessel.last_fishing_date
    ? new Date(vessel.last_fishing_date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: '2-digit' })
    : '—'

  return (
    <div
      className={`tracker-card ${!hasGfw ? 'tracker-card--untracked' : ''}`}
      onClick={() => hasGfw && onViewDetail(vessel)}
    >
      <div className="tracker-card-header">
        {hasGfw && (
          <input
            type="checkbox"
            className="tracker-include-checkbox"
            checked={included}
            onChange={() => onToggleInclude(vessel.id)}
            onClick={e => e.stopPropagation()}
            title={included ? 'Tracked' : 'Not tracked'}
          />
        )}
        <span className="tracker-name">{vessel.vessel_name}</span>
        <span className="tracker-flag">{flagFor(vessel.flag)}</span>
        {!hasGfw && <span className="no-gfw-badge">no GFW</span>}
      </div>
      {hasGfw && (
        <div className="tracker-card-stats">
          <span title="Fishing events">⚓ {Number(vessel.fishing_event_count).toLocaleString()}</span>
          <span title="Encounters">🤝 {vessel.encounter_count}</span>
          <span title="AIS gaps">📡 {vessel.ais_gap_count}</span>
          <span className="tracker-last-seen" title="Last fishing event">{lastSeen}</span>
        </div>
      )}
    </div>
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
        <div className="tracker-grid">
          {tracked.map(v => (
            <VesselCard
              key={v.id}
              vessel={v}
              included={includedIds.has(v.id)}
              onToggleInclude={onToggleInclude}
              onViewDetail={onViewDetail}
            />
          ))}
        </div>

        {untracked.length > 0 && (
          <>
            <div className="tracker-divider">No GFW match ({untracked.length})</div>
            <div className="tracker-grid">
              {untracked.map(v => (
                <VesselCard key={v.id} vessel={v} included={false} onToggleInclude={() => {}} onViewDetail={() => {}} />
              ))}
            </div>
          </>
        )}

        {tracked.length === 0 && untracked.length === 0 && (
          <div className="tracker-empty">No vessels match "{query}"</div>
        )}
      </div>
    </div>
  )
}
