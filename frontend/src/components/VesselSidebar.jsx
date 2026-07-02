import { useState } from 'react'
import { flagFor } from '../flags'
import './VesselSidebar.css'

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

function VesselCard({ vessel, selected, onSelect, included, onToggleInclude }) {
  const hasGfw    = !!vessel.gfw_vessel_id
  const lastSeen  = vessel.last_fishing_date
    ? new Date(vessel.last_fishing_date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: '2-digit' })
    : '—'

  return (
    <div
      className={`vessel-card ${selected ? 'vessel-card--selected' : ''} ${!hasGfw ? 'vessel-card--untracked' : ''}`}
      onClick={() => hasGfw && onSelect(vessel)}
    >
      <div className="vessel-card-header">
        {hasGfw && (
          <input
            type="checkbox"
            className="vessel-include-checkbox"
            checked={included}
            onChange={() => onToggleInclude(vessel.id)}
            onClick={e => e.stopPropagation()}
            title={included ? 'Included on map' : 'Excluded from map'}
          />
        )}
        <span className="vessel-name">{vessel.vessel_name}</span>
        <span className="vessel-flag">{flagFor(vessel.flag)}</span>
        {!hasGfw && <span className="no-gfw-badge">no GFW</span>}
      </div>
      {hasGfw && (
        <div className="vessel-card-stats">
          <span title="Fishing events">⚓ {Number(vessel.fishing_event_count).toLocaleString()}</span>
          <span title="Encounters">🤝 {vessel.encounter_count}</span>
          <span title="AIS gaps">📡 {vessel.ais_gap_count}</span>
          <span className="vessel-last-seen" title="Last fishing event">{lastSeen}</span>
        </div>
      )}
    </div>
  )
}

export default function VesselSidebar({ vessels, selected, onSelect, includedIds, onToggleInclude, onSetIncluded }) {
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

  const tracked   = vessels.filter(v => v.gfw_vessel_id && matches(v)).sort(sortFn)
  const untracked = vessels.filter(v => !v.gfw_vessel_id && matches(v)).sort(sortFn)
  const totalTracked = vessels.filter(v => v.gfw_vessel_id).length

  const toggleSortDir = () => setSortDir(d => -d)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        FLEET
        <span className="sidebar-count">{includedIds.size} / {totalTracked} on map</span>
      </div>
      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Search vessels…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      <div className="sidebar-toolbar">
        <select
          className="sidebar-sort-select"
          value={sortKey}
          onChange={e => setSortKey(e.target.value)}
          title="Sort by"
        >
          {SORT_OPTIONS.map(o => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button
          className="sidebar-sort-dir"
          onClick={toggleSortDir}
          title={sortDir === 1 ? 'Ascending' : 'Descending'}
        >
          {sortDir === 1 ? '↑' : '↓'}
        </button>
        <div className="sidebar-toolbar-spacer" />
        <button className="sidebar-link-btn" onClick={() => onSetIncluded(tracked.map(v => v.id))}>All</button>
        <button className="sidebar-link-btn" onClick={() => onSetIncluded([])}>None</button>
      </div>
      <div className="vessel-list">
        {tracked.map(v => (
          <VesselCard
            key={v.id}
            vessel={v}
            selected={selected?.id === v.id}
            onSelect={onSelect}
            included={includedIds.has(v.id)}
            onToggleInclude={onToggleInclude}
          />
        ))}
        {untracked.length > 0 && (
          <>
            <div className="sidebar-divider">No GFW match ({untracked.length})</div>
            {untracked.map(v => (
              <VesselCard key={v.id} vessel={v} selected={false} onSelect={onSelect} />
            ))}
          </>
        )}
        {tracked.length === 0 && untracked.length === 0 && (
          <div className="sidebar-empty">No vessels match "{query}"</div>
        )}
      </div>
    </aside>
  )
}
