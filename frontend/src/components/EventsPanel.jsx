import { useEffect, useState } from 'react'
import { applyTimeframeParams } from '../timeframe'
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

// "Offloading" events — the catch leaves the vessel here, either handed off
// to a carrier at sea (transshipment) or landed directly at port. These get
// the orange highlight; ordinary fishing activity and AIS gaps don't.
const OFFLOAD_KINDS = new Set(['encounter', 'port_visit'])

const KIND_META = {
  fishing:     { icon: '🎣', label: 'Fishing'       },
  encounter:   { icon: '🫱🏻‍🫲🏼', label: 'Transshipment' },
  ais_gap:     { icon: '📡', label: 'AIS Gap'        },
  port_visit:  { icon: '⚓', label: 'Port Visit'     },
}

function buildTimeline({ fishing, encounters, ais_gaps, ports }) {
  const rows = []

  for (const e of fishing) {
    rows.push({
      key: e.event_id, date: e.start_time, kind: 'fishing',
      vessel_id: e.vessel_id, vessel_name: e.vessel_name,
      summary: `Fishing · ${fmtHours(e.duration_hours)}${e.fao_areas?.length ? ` · FAO ${e.fao_areas.join(', ')}` : ''}`,
      lat: e.lat, lon: e.lon,
    })
  }
  for (const e of encounters) {
    rows.push({
      key: e.event_id, date: e.start_time, kind: 'encounter',
      vessel_id: e.vessel_id, vessel_name: e.vessel_name,
      summary: `Met ${e.encountered_vessel_name || 'vessel'} · ${fmtHours(e.duration_hours)} alongside`,
      lat: e.lat, lon: e.lon,
      encountered_vessel_name: e.encountered_vessel_name,
      encountered_vessel_flag: e.encountered_vessel_flag,
    })
  }
  for (const e of ais_gaps) {
    rows.push({
      key: e.event_id, date: e.start_time, kind: 'ais_gap',
      vessel_id: e.vessel_id, vessel_name: e.vessel_name,
      summary: `Gap · ${fmtHours(e.gap_hours)}${e.distance_km ? ` · ${Math.round(e.distance_km)} km` : ''}`,
      alert: e.gap_hours > 168,
      lat: e.lat_off, lon: e.lon_off,
      lat_on: e.lat_on, lon_on: e.lon_on,
      gap_hours: e.gap_hours,
    })
  }
  for (const e of ports) {
    rows.push({
      key: e.event_id, date: e.start_time, kind: 'port_visit',
      vessel_id: e.vessel_id, vessel_name: e.vessel_name,
      summary: `Arrived ${e.port_name || 'port'}${e.port_flag ? `, ${e.port_flag}` : ''}`,
      lat: e.port_lat, lon: e.port_lon,
      port_name: e.port_name, port_flag: e.port_flag,
    })
  }

  return rows.sort((a, b) => new Date(b.date) - new Date(a.date))
}

function TimelineRow({ row, isSelected, onSelectVesselId, onSelectEvent }) {
  const meta = KIND_META[row.kind]
  const isOffload = OFFLOAD_KINDS.has(row.kind)

  return (
    <tr
      className={`timeline-row ${isOffload ? 'timeline-row--offload' : ''} ${row.alert ? 'row--alert' : ''} ${isSelected ? 'timeline-row--selected' : ''}`}
      onClick={() => onSelectEvent(row)}
    >
      <td className="cell-date">{fmt(row.date)}</td>
      {onSelectVesselId ? (
        <td className="cell-vessel cell-vessel--clickable" onClick={e => { e.stopPropagation(); onSelectVesselId(row.vessel_id) }}>
          {row.vessel_name}
        </td>
      ) : (
        <td className="cell-vessel">{row.vessel_name}</td>
      )}
      <td className="cell-summary">
        <span className="kind-icon" title={meta.label}>{meta.icon}</span>
        {row.summary}
      </td>
    </tr>
  )
}

export default function EventsPanel({ selectedVessel, includedIds, onSelectVesselId, selectedEvent, onSelectEvent, days, customRange, onGoToTracker }) {
  const [data, setData] = useState({ fishing: [], encounters: [], ais_gaps: [], ports: [] })

  const noVesselsTracked = !selectedVessel && includedIds && includedIds.size === 0

  useEffect(() => {
    if (noVesselsTracked) {
      setData({ fishing: [], encounters: [], ais_gaps: [], ports: [] })
      return
    }

    // Same timeframe as the map's timeframe bar — full history when a single
    // vessel is selected, otherwise the shared preset/custom range applies.
    const buildParams = (limit) => {
      const params = new URLSearchParams({ limit })
      if (selectedVessel) params.set('vessel_id', selectedVessel.id)
      else if (includedIds) params.set('vessel_ids', [...includedIds].join(','))
      applyTimeframeParams(params, { selectedVessel, days, customRange })
      return params
    }

    // Fishing events vastly outnumber encounters/gaps/port-visits (per vessel,
    // up to ~4-5k vs. well under 100; fleet-wide, tens of thousands vs. a few
    // hundred). Capping every type at the same row count truncates fishing to
    // a much narrower recent slice than the rarer types reach, making the
    // merged timeline look like separate chronological blocks instead of one
    // interleaved feed. Fix: fetch the rarer types generously (cheap — their
    // totals are small) first, then bound the fishing fetch to however far
    // back they actually reached, so nothing outruns anything else.
    const isUnboundedFleetView = !selectedVessel && !days && !customRange?.from

    Promise.all([
      fetch(`/api/encounters?${buildParams(1000)}`).then(r => r.json()),
      fetch(`/api/ais-gaps?${buildParams(1000)}`).then(r => r.json()),
      fetch(`/api/port-visits?${buildParams(1000)}`).then(r => r.json()),
    ]).then(([encounters, ais_gaps, ports]) => {
      const fishingParams = buildParams(selectedVessel ? 5000 : 3000)

      if (isUnboundedFleetView) {
        const sparseDates = [...encounters, ...ais_gaps, ...ports].map(e => e.start_time).filter(Boolean)
        if (sparseDates.length) {
          const oldest = sparseDates.reduce((a, b) => (a < b ? a : b))
          fishingParams.set('start_date', oldest.slice(0, 10))
        }
      }

      fetch(`/api/fishing-events?${fishingParams}`).then(r => r.json()).then(fishing => {
        setData({ fishing, encounters, ais_gaps, ports })
      })
    })
  }, [selectedVessel, includedIds, noVesselsTracked, days, customRange])

  const timeline = buildTimeline(data)

  return (
    <div className="events-panel">
      <div className="events-header">
        <span className="events-title">All Events (Chronological)</span>
        <span className="tab-count">{timeline.length}</span>
        {selectedVessel && <span className="events-context">— {selectedVessel.vessel_name}</span>}
        <span className="events-legend">
          <span className="events-legend-dot" /> Transshipment / port offload
        </span>
      </div>
      <div className="events-body">
        {noVesselsTracked ? (
          <div className="empty-state">No vessels tracked — head to <button className="empty-state-link" onClick={onGoToTracker}>Fishing Vessel Tracking</button> to select vessels.</div>
        ) : timeline.length === 0 ? (
          <div className="empty-state">No events found.</div>
        ) : (
          <table className="events-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Vessel</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {timeline.map(row => (
                <TimelineRow
                  key={row.key}
                  row={row}
                  isSelected={selectedEvent?.key === row.key}
                  onSelectVesselId={onSelectVesselId}
                  onSelectEvent={onSelectEvent}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
