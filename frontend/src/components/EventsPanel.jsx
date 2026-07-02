import { useEffect, useState, useCallback } from 'react'
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

const TIPS = {
  Vessel:   'The CCAMLR-authorised fishing vessel name.',
  Date:     'Date the fishing activity started.',
  Duration: 'How long the fishing event lasted. Detected from AIS movement patterns — slow speed and turns typical of longline setting or hauling.',
  'FAO Area': 'FAO fishing area code where the event occurred. Southern Ocean toothfish subareas: 48.x (South Atlantic / South Georgia), 58.x (Indian Ocean / Kerguelen), 88.x (Ross Sea).',
  Species:  'Target species this vessel is CCAMLR-authorised to catch. D. eleginoides = Patagonian toothfish. D. mawsoni = Antarctic toothfish.',
  RFMO:     'Regional Fisheries Management Organisation governing this area. CCAMLR governs all Southern Ocean toothfish waters.',
}

function Th({ label }) {
  const [pos, setPos] = useState(null)

  const show = useCallback((e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPos({ x: r.left + r.width / 2, y: r.bottom })
  }, [])

  return (
    <th className="th-hoverable" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {label}
      {pos && TIPS[label] && (
        <div
          className="col-tooltip"
          style={{ left: pos.x, top: pos.y + 6 }}
        >
          {TIPS[label]}
        </div>
      )}
    </th>
  )
}

function VesselCell({ vesselId, vesselName, onSelectVesselId }) {
  if (!onSelectVesselId) return <td className="cell-vessel">{vesselName}</td>
  return (
    <td className="cell-vessel cell-vessel--clickable" onClick={() => onSelectVesselId(vesselId)}>
      {vesselName}
    </td>
  )
}

function FishingTable({ rows, onSelectVesselId }) {
  if (!rows.length) return <div className="empty-state">No fishing events found.</div>
  return (
    <table className="events-table">
      <thead>
        <tr>
          <Th label="Vessel" />
          <Th label="Date" />
          <Th label="Duration" />
          <Th label="FAO Area" />
          <Th label="Species" />
          <Th label="RFMO" />
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.event_id}>
            <VesselCell vesselId={e.vessel_id} vesselName={e.vessel_name} onSelectVesselId={onSelectVesselId} />
            <td>{fmt(e.start_time)}</td>
            <td>{fmtHours(e.duration_hours)}</td>
            <td>{e.fao_areas?.join(', ') || '—'}</td>
            <td className="cell-species">{e.target_species?.join(', ') || '—'}</td>
            <td className="cell-muted">{e.rfmo_areas?.join(', ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EncountersTable({ rows, onSelectVesselId }) {
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
            <VesselCell vesselId={e.vessel_id} vesselName={e.vessel_name} onSelectVesselId={onSelectVesselId} />
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

function AisGapsTable({ rows, onSelectVesselId }) {
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
            <VesselCell vesselId={e.vessel_id} vesselName={e.vessel_name} onSelectVesselId={onSelectVesselId} />
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

function PortVisitsTable({ rows, onSelectVesselId }) {
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
            <VesselCell vesselId={e.vessel_id} vesselName={e.vessel_name} onSelectVesselId={onSelectVesselId} />
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

export default function EventsPanel({ selectedVessel, includedIds, activeTab, onTabChange, onSelectVesselId }) {
  const [data, setData] = useState({ fishing: [], encounters: [], ais_gaps: [], ports: [] })

  const noVesselsTracked = !selectedVessel && includedIds && includedIds.size === 0

  useEffect(() => {
    if (noVesselsTracked) {
      setData({ fishing: [], encounters: [], ais_gaps: [], ports: [] })
      return
    }

    let vidParam = ''
    if (selectedVessel) vidParam = `&vessel_id=${selectedVessel.id}`
    else if (includedIds) vidParam = `&vessel_ids=${[...includedIds].join(',')}`

    Promise.all([
      fetch(`/api/fishing-events?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/encounters?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/ais-gaps?limit=100${vidParam}`).then(r => r.json()),
      fetch(`/api/port-visits?limit=100${vidParam}`).then(r => r.json()),
    ]).then(([fishing, encounters, ais_gaps, ports]) => {
      setData({ fishing, encounters, ais_gaps, ports })
    })
  }, [selectedVessel, includedIds, noVesselsTracked])

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
        {noVesselsTracked ? (
          <div className="empty-state">No vessels tracked — head to <strong>Vessel Tracker</strong> to select vessels.</div>
        ) : (
          <>
            {activeTab === 'fishing'    && <FishingTable    rows={data.fishing}    onSelectVesselId={onSelectVesselId} />}
            {activeTab === 'encounters' && <EncountersTable rows={data.encounters} onSelectVesselId={onSelectVesselId} />}
            {activeTab === 'ais_gaps'   && <AisGapsTable    rows={data.ais_gaps}   onSelectVesselId={onSelectVesselId} />}
            {activeTab === 'ports'      && <PortVisitsTable rows={data.ports}      onSelectVesselId={onSelectVesselId} />}
          </>
        )}
      </div>
    </div>
  )
}
