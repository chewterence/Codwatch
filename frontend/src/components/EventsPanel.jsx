import { useEffect, useState } from 'react'
import './EventsPanel.css'

function fmt(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: '2-digit',
  })
}

function fmtHours(h) {
  if (h == null) return '—'
  if (h >= 24) return `${(h / 24).toFixed(1)}d`
  return `${h.toFixed(1)}h`
}

function FishingTable({ rows }) {
  if (!rows.length) return <div className="empty-state">No fishing events found.</div>
  return (
    <table className="events-table">
      <thead>
        <tr>
          <th>Vessel</th>
          <th>Date</th>
          <th>Duration</th>
          <th>FAO Area</th>
          <th>RFMO</th>
          <th>Auth</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.event_id}>
            <td className="cell-vessel">{e.vessel_name}</td>
            <td>{fmt(e.start_time)}</td>
            <td>{fmtHours(e.duration_hours)}</td>
            <td>{e.fao_areas?.join(', ') || '—'}</td>
            <td>{e.rfmo_areas?.join(', ') || '—'}</td>
            <td>
              {e.auth_status === 'publicly_authorized'
                ? <span className="badge badge--ok">✓</span>
                : e.auth_status
                  ? <span className="badge badge--warn">!</span>
                  : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EncountersTable({ rows }) {
  if (!rows.length) return <div className="empty-state">No encounters found.</div>
  return (
    <table className="events-table">
      <thead>
        <tr>
          <th>Vessel</th>
          <th>Met</th>
          <th>Date</th>
          <th>Duration</th>
          <th>Type</th>
          <th>FAO Area</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.event_id}>
            <td className="cell-vessel">{e.vessel_name}</td>
            <td className="cell-vessel">{e.encountered_vessel_name || '—'}</td>
            <td>{fmt(e.start_time)}</td>
            <td>{fmtHours(e.duration_hours)}</td>
            <td>{e.encounter_type || '—'}</td>
            <td>{e.fao_areas?.join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AisGapsTable({ rows }) {
  if (!rows.length) return <div className="empty-state">No AIS gaps found.</div>
  return (
    <table className="events-table">
      <thead>
        <tr>
          <th>Vessel</th>
          <th>Gap Start</th>
          <th>Gap Duration</th>
          <th>Distance</th>
          <th>FAO Area</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.event_id} className={e.gap_hours > 168 ? 'row--alert' : ''}>
            <td className="cell-vessel">{e.vessel_name}</td>
            <td>{fmt(e.start_time)}</td>
            <td>
              <span className={e.gap_hours > 168 ? 'badge badge--warn' : ''}>
                {fmtHours(e.gap_hours)}
              </span>
            </td>
            <td>{e.distance_km ? `${Math.round(e.distance_km)} km` : '—'}</td>
            <td>{e.fao_areas?.join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PortVisitsTable({ rows }) {
  if (!rows.length) return <div className="empty-state">No port visits found.</div>
  return (
    <table className="events-table">
      <thead>
        <tr>
          <th>Vessel</th>
          <th>Port</th>
          <th>Country</th>
          <th>Arrived</th>
          <th>Duration</th>
          <th>Confidence</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.event_id}>
            <td className="cell-vessel">{e.vessel_name}</td>
            <td>{e.port_name || '—'}</td>
            <td>{e.port_flag || '—'}</td>
            <td>{fmt(e.start_time)}</td>
            <td>{fmtHours(e.duration_hours)}</td>
            <td>{e.confidence ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const TABS = [
  { id: 'fishing',    label: 'Fishing Events' },
  { id: 'encounters', label: 'Encounters'      },
  { id: 'ais_gaps',   label: 'AIS Gaps'        },
  { id: 'ports',      label: 'Port Visits'     },
]

export default function EventsPanel({ selectedVessel, activeTab, onTabChange }) {
  const [data, setData] = useState({ fishing: [], encounters: [], ais_gaps: [], ports: [] })

  useEffect(() => {
    const vidParam = selectedVessel ? `&vessel_id=${selectedVessel.id}` : ''
    Promise.all([
      fetch(`/api/fishing-events?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/encounters?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/ais-gaps?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/port-visits?limit=100${vidParam}`).then(r => r.json()),
    ]).then(([fishing, encounters, ais_gaps, ports]) => {
      setData({ fishing, encounters, ais_gaps, ports })
    })
  }, [selectedVessel])

  return (
    <div className="events-panel">
      <div className="events-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${activeTab === t.id ? 'tab-btn--active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
            <span className="tab-count">
              {t.id === 'fishing'    && data.fishing.length}
              {t.id === 'encounters' && data.encounters.length}
              {t.id === 'ais_gaps'   && data.ais_gaps.length}
              {t.id === 'ports'      && data.ports.length}
            </span>
          </button>
        ))}
        {selectedVessel && (
          <span className="events-context">— {selectedVessel.vessel_name}</span>
        )}
      </div>
      <div className="events-body">
        {activeTab === 'fishing'    && <FishingTable    rows={data.fishing}    />}
        {activeTab === 'encounters' && <EncountersTable rows={data.encounters} />}
        {activeTab === 'ais_gaps'   && <AisGapsTable    rows={data.ais_gaps}   />}
        {activeTab === 'ports'      && <PortVisitsTable rows={data.ports}      />}
      </div>
    </div>
  )
}
