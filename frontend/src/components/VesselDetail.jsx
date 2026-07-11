import { useState, useEffect } from 'react'
import VoyageTimeline from './VoyageTimeline'
import VesselMap from './VesselMap'
import { flagFor, portFlagDisplay } from '../flags'
import './VesselDetail.css'

function fmt(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function fmtHours(h) {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)}d`
  return `${h.toFixed(1)}h`
}

function PortHistoryTable({ ports }) {
  if (!ports.length) {
    return (
      <div className="port-empty">
        <div className="port-empty-title">No port landings recorded in this period</div>
      </div>
    )
  }
  return (
    <table className="port-table">
      <thead>
        <tr>
          <th>Port</th>
          <th>Country</th>
          <th title="Approximate — derived from last loitering event before port call">Approx. Arrival ⓘ</th>
        </tr>
      </thead>
      <tbody>
        {ports.map(p => {
          const { emoji, name } = portFlagDisplay(p.port_flag)
          return (
            <tr key={p.event_id}>
              <td className="port-name">{p.port_name || '—'}</td>
              <td>{p.port_flag ? `${emoji} ${name}` : '—'}</td>
              <td>{fmt(p.start_time)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const RANGES = [
  { months: 1,  label: 'Past 1 month'  },
  { months: 6,  label: 'Past 6 months' },
  { months: 12, label: 'Past 1 year'   },
  { months: 24, label: 'Past 2 years'  },
  { months: 60, label: 'All'           },
]

// Matches BACKFILL_START in database/backfill.py — no vessel's fishing/port
// data goes back further than this, regardless of how far its own AIS
// history (gfw_ais_from) extends, so the "All" label is clamped to it.
const DATA_FLOOR_DATE = new Date('2022-01-01')

function allSinceYear(vessel) {
  const aisFrom = vessel.gfw_ais_from ? new Date(vessel.gfw_ais_from) : null
  const effective = aisFrom && aisFrom > DATA_FLOOR_DATE ? aisFrom : DATA_FLOOR_DATE
  return effective.getFullYear()
}

export default function VesselDetail({ vessel, onBack }) {
  const [months, setMonths] = useState(12)
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!vessel) return
    let cancelled = false
    setLoading(true)
    setData(null)
    fetch(`/api/vessels/${vessel.id}/timeline?months=${months}`)
      .then(r => r.json())
      .then(d => {
        // Guards against a slower, superseded request (e.g. switching range
        // buttons quickly) resolving after a newer one and clobbering it.
        if (!cancelled) { setData(d); setLoading(false) }
      })
    return () => { cancelled = true }
  }, [vessel?.id, months])

  const flag = flagFor(vessel.flag)

  return (
    <div className="vessel-detail">
      <div className="detail-header">
        <div className="detail-toprow">
          <button className="detail-back" onClick={onBack}>← Fleet</button>
          <span className="detail-section-label">Fishing Vessel Intelligence</span>
          <div className="detail-range">
            {RANGES.map(r => (
              <button
                key={r.months}
                className={`range-btn ${months === r.months ? 'range-btn--active' : ''}`}
                onClick={() => setMonths(r.months)}
              >
                {r.months === 60 ? `All since ${allSinceYear(vessel)}` : r.label}
              </button>
            ))}
          </div>
        </div>

        {/* The obvious header: who the vessel is, where it's from, what it's
            doing, and what it's authorized to catch. Everything else about
            it (event counts) is secondary detail below. */}
        <div className="detail-mainrow">
          <div className="detail-identity">
            <span className="detail-flag">{flag}</span>
            <div className="detail-identity-text">
              <span className="detail-name">{vessel.vessel_name}</span>
              <span className="detail-country">{vessel.flag}</span>
            </div>
          </div>

          {vessel.last_activity_type && (
            <div className="detail-status">
              <span className={`status-pill status-pill--${vessel.last_activity_type}`}>
                {vessel.last_activity_type === 'fishing'
                  ? '🎣 Fishing'
                  : `⚓ In port${vessel.last_port_name ? ` · ${vessel.last_port_name}` : ''}`}
              </span>
              <span className="status-lasttracked">Last tracked {fmt(vessel.last_activity_time)}</span>
            </div>
          )}

          <div className="detail-species">
            {vessel.eleginoides_authorized && <span className="species-pill">D. eleginoides</span>}
            {vessel.mawsoni_authorized     && <span className="species-pill">D. mawsoni</span>}
          </div>
        </div>

        <div className="detail-substats">
          <span className="substat kpi-item" data-tooltip="Times this vessel was detected actively fishing, based on its speed and movement pattern.">
            <span className="substat-value">🎣 {Number(vessel.fishing_event_count).toLocaleString()}</span>
            <span className="substat-label">Fishing events</span>
          </span>
          <span className="substat kpi-item" data-tooltip="Times this vessel met another vessel at sea — often used to transfer catch without visiting port.">
            <span className="substat-value">🤝 {vessel.encounter_count}</span>
            <span className="substat-label">Encounters</span>
          </span>
          <span className="substat kpi-item" data-tooltip="Times this vessel's tracking signal went dark for an extended stretch — a possible sign of hidden activity.">
            <span className="substat-value">📡 {vessel.ais_gap_count}</span>
            <span className="substat-label">AIS gaps</span>
          </span>
        </div>
      </div>

      {loading ? (
        <div className="detail-loading">Loading voyage data…</div>
      ) : (
        <>
          <div className="detail-mapport-row">
            <div className="port-section">
              <div className="port-section-title">Port Landing History</div>
              <PortHistoryTable ports={data?.port_visits || []} />
            </div>
            <VesselMap />
          </div>
          <VoyageTimeline
            fishingEvents={data?.fishing_events}
            portVisits={data?.port_visits}
            aisGaps={data?.ais_gaps}
            encounters={data?.encounters}
          />
        </>
      )}
    </div>
  )
}
