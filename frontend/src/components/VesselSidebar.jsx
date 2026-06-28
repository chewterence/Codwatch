import './VesselSidebar.css'

const FLAG_EMOJI = {
  Australia:          '🇦🇺',
  Chile:              '🇨🇱',
  China:              '🇨🇳',
  France:             '🇫🇷',
  Japan:              '🇯🇵',
  'Korea, Republic of': '🇰🇷',
  Namibia:            '🇳🇦',
  'New Zealand':      '🇳🇿',
  'Russian Federation': '🇷🇺',
  'South Africa':     '🇿🇦',
  Spain:              '🇪🇸',
  Ukraine:            '🇺🇦',
  'United Kingdom':   '🇬🇧',
  Uruguay:            '🇺🇾',
}

function VesselCard({ vessel, selected, onSelect }) {
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
        <span className="vessel-flag">{FLAG_EMOJI[vessel.flag] || '🏳️'}</span>
        <span className="vessel-name">{vessel.vessel_name}</span>
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

export default function VesselSidebar({ vessels, selected, onSelect }) {
  const tracked   = vessels.filter(v => v.gfw_vessel_id)
  const untracked = vessels.filter(v => !v.gfw_vessel_id)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        FLEET
        <span className="sidebar-count">{tracked.length} tracked</span>
      </div>
      <div className="vessel-list">
        {tracked.map(v => (
          <VesselCard
            key={v.id}
            vessel={v}
            selected={selected?.id === v.id}
            onSelect={onSelect}
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
      </div>
    </aside>
  )
}
