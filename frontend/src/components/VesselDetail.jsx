import { useState, useEffect } from 'react'
import VoyageTimeline from './VoyageTimeline'
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
    setLoading(true)
    setData(null)
    fetch(`/api/vessels/${vessel.id}/timeline?months=${months}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
  }, [vessel?.id, months])

  const flag = flagFor(vessel.flag)

  return (
    <div className="vessel-detail">
      <div className="detail-header">
        <button className="detail-back" onClick={onBack}>← Fleet</button>
        <span className="detail-section-label">Fishing Vessel Intelligence</span>

        <div className="detail-identity">
          <span className="detail-flag">{flag}</span>
          <span className="detail-name">{vessel.vessel_name}</span>
          <span className="detail-country">{vessel.flag}</span>
        </div>

        <div className="detail-kpis">
          <span className="kpi-item" data-tooltip="Times this vessel was detected actively fishing, based on its speed and movement pattern.">
            🎣 {Number(vessel.fishing_event_count).toLocaleString()}
          </span>
          <span className="kpi-item" data-tooltip="Times this vessel met another vessel at sea — often used to transfer catch without visiting port.">
            🫱🏻‍🫲🏼 {vessel.encounter_count}
          </span>
          <span className="kpi-item" data-tooltip="Times this vessel's tracking signal went dark for an extended stretch — a possible sign of hidden activity.">
            📡 {vessel.ais_gap_count}
          </span>
          {vessel.eleginoides_authorized && <span className="species-pill">D. eleginoides</span>}
          {vessel.mawsoni_authorized     && <span className="species-pill">D. mawsoni</span>}
        </div>

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

      {loading ? (
        <div className="detail-loading">Loading voyage data…</div>
      ) : (
        <>
          <VoyageTimeline
            fishingEvents={data?.fishing_events}
            portVisits={data?.port_visits}
            aisGaps={data?.ais_gaps}
            encounters={data?.encounters}
          />
          <div className="port-section">
            <div className="port-section-title">Port Landing History</div>
            <PortHistoryTable ports={data?.port_visits || []} />
          </div>
        </>
      )}
    </div>
  )
}
