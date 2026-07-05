import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Marker, Polyline, Popup, AttributionControl, useMap } from 'react-leaflet'
import L from 'leaflet'
import { TIMEFRAME_PRESETS, applyTimeframeParams, timeframeLabel, allSinceLabel, presetDateRange } from '../timeframe'
import './FleetMap.css'

// Distinct marker for fishing-carrier encounters (potential transshipment) —
// a diamond shape in an alert colour, deliberately different from the
// per-vessel coloured dots used for fishing events.
const carrierIcon = L.divIcon({
  className: 'carrier-marker-wrapper',
  html: '<div class="carrier-marker-diamond"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

// Distinct marker for a carrier's offload port — a square, different again
// from the encounter diamond and the per-vessel dots.
const portIcon = L.divIcon({
  className: 'port-marker-wrapper',
  html: '<div class="port-marker-square"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
})

// Direct port landings by our own fleet — same "offload" family as the
// carrier markers (orange), but a triangle so it reads as a distinct kind
// from the encounter diamond and the carrier-offload square.
const portVisitIcon = L.divIcon({
  className: 'port-visit-marker-wrapper',
  html: '<div class="port-visit-marker-triangle"></div>',
  iconSize: [14, 14],
  iconAnchor: [7, 9],
})

// Marks whichever event the user clicked in the left-hand timeline — a
// pulsing ring so it's obvious which one is "selected" among the regular dots.
const selectedEventIcon = L.divIcon({
  className: 'selected-event-wrapper',
  html: '<div class="selected-event-ring"></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

const EVENT_KIND_LABELS = {
  fishing:    'Fishing event',
  encounter:  'Encounter',
  ais_gap:    'AIS gap',
  port_visit: 'Port visit',
}

// Vessel colour palette — one colour per vessel id (cycles if > palette length)
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
]

function colourFor(vesselId) {
  return PALETTE[vesselId % PALETTE.length]
}

function fmt(isoStr) {
  if (!isoStr) return '—'
  const d = new Date(isoStr)
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

// Fly to a vessel's latest event position when selection changes
function MapFlyTo({ events, selectedVessel }) {
  const map = useMap()

  useEffect(() => {
    if (!selectedVessel || !events.length) return
    const latest = events.find(e => e.vessel_id === selectedVessel.id)
    if (latest) {
      map.flyTo([latest.lat, latest.lon], 5, { duration: 1.2 })
    }
  }, [selectedVessel, events, map])

  return null
}

// Fly to and highlight whichever event was clicked in the EventsPanel timeline.
// AIS gaps carry both a "went dark" and "reappeared" position — draw the gap
// as a line between them, same visual language as the offload lines.
function SelectedEventLayer({ event }) {
  const map = useMap()
  const markerRef = useRef(null)

  useEffect(() => {
    if (!event || event.lat == null || event.lon == null) return
    map.flyTo([event.lat, event.lon], 7, { duration: 1.2 })
  }, [event, map])

  useEffect(() => {
    if (markerRef.current) markerRef.current.openPopup()
  }, [event])

  if (!event || event.lat == null || event.lon == null) return null

  return (
    <>
      {event.kind === 'ais_gap' && event.lat_on != null && event.lon_on != null && (
        <Polyline
          positions={[[event.lat, event.lon], [event.lat_on, event.lon_on]]}
          pathOptions={{ color: '#ef4444', weight: 1.5, dashArray: '2 6', opacity: 0.7 }}
        />
      )}
      <Marker ref={markerRef} position={[event.lat, event.lon]} icon={selectedEventIcon}>
        <Popup>
          <div className="map-popup">
            <strong>{EVENT_KIND_LABELS[event.kind] || 'Event'}</strong>
            <span>{event.vessel_name}</span>
            <span>{fmt(event.date)}</span>
            <span>{event.summary}</span>
          </div>
        </Popup>
      </Marker>
    </>
  )
}

// The map container's size can change after Leaflet's initial measurement
// (e.g. the events panel next to it changing width) — keep tiles in sync.
function MapResizeSync() {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(container)
    return () => observer.disconnect()
  }, [map])

  return null
}

export default function FleetMap({ selectedVessel, includedIds, onSelectVesselId, selectedEvent, days, onDaysChange, customRange, onCustomRangeChange, earliestDate }) {
  const [events, setEvents] = useState([])
  const [carrierEncounters, setCarrierEncounters] = useState([])
  const [offloads, setOffloads] = useState([])
  const [portVisits, setPortVisits] = useState([])
  const [loading, setLoading] = useState(true)
  const [draftFrom, setDraftFrom] = useState(customRange?.from || '')
  const [draftTo, setDraftTo] = useState(customRange?.to || '')

  // Keep the date-range inputs showing the concrete dates for whichever
  // preset is active, or the applied custom range — always in sync, never
  // stale, without the user having to open anything first.
  useEffect(() => {
    if (customRange?.from && customRange?.to) {
      setDraftFrom(customRange.from)
      setDraftTo(customRange.to)
    } else {
      const { from, to } = presetDateRange(days, earliestDate)
      setDraftFrom(from)
      setDraftTo(to)
    }
  }, [days, customRange, earliestDate])

  useEffect(() => {
    if (!selectedVessel && includedIds && includedIds.size === 0) {
      setEvents([])
      setLoading(false)
      return
    }

    setLoading(true)
    const params = new URLSearchParams({ limit: 800 })
    if (selectedVessel) {
      params.set('vessel_id', selectedVessel.id)
    } else {
      applyTimeframeParams(params, { selectedVessel, days, customRange })
      if (includedIds) params.set('vessel_ids', [...includedIds].join(','))
    }

    fetch(`/api/fishing-events?${params}`)
      .then(r => r.json())
      .then(data => { setEvents(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedVessel, includedIds, days, customRange])

  useEffect(() => {
    if (!selectedVessel && includedIds && includedIds.size === 0) {
      setCarrierEncounters([])
      return
    }

    const params = new URLSearchParams({ limit: 200, encounter_type: 'fishing-carrier' })
    if (selectedVessel) {
      params.set('vessel_id', selectedVessel.id)
    } else {
      applyTimeframeParams(params, { selectedVessel, days, customRange })
      if (includedIds) params.set('vessel_ids', [...includedIds].join(','))
    }

    fetch(`/api/encounters?${params}`)
      .then(r => r.json())
      .then(setCarrierEncounters)
      .catch(() => {})
  }, [selectedVessel, includedIds, days, customRange])

  useEffect(() => {
    if (!selectedVessel && includedIds && includedIds.size === 0) {
      setOffloads([])
      return
    }

    const params = new URLSearchParams({ limit: 300 })
    if (selectedVessel) {
      params.set('vessel_id', selectedVessel.id)
    } else {
      applyTimeframeParams(params, { selectedVessel, days, customRange })
      if (includedIds) params.set('vessel_ids', [...includedIds].join(','))
    }

    fetch(`/api/transshipment-offloads?${params}`)
      .then(r => r.json())
      .then(setOffloads)
      .catch(() => {})
  }, [selectedVessel, includedIds, days, customRange])

  useEffect(() => {
    if (!selectedVessel && includedIds && includedIds.size === 0) {
      setPortVisits([])
      return
    }

    const params = new URLSearchParams({ limit: 300 })
    if (selectedVessel) {
      params.set('vessel_id', selectedVessel.id)
    } else {
      applyTimeframeParams(params, { selectedVessel, days, customRange })
      if (includedIds) params.set('vessel_ids', [...includedIds].join(','))
    }

    fetch(`/api/port-visits?${params}`)
      .then(r => r.json())
      .then(setPortVisits)
      .catch(() => {})
  }, [selectedVessel, includedIds, days, customRange])

  // Only the port visits whose port we can actually place on the map
  const placedPortVisits = portVisits.filter(pv => pv.port_lat != null && pv.port_lon != null)

  // Only the offloads whose port we can actually place on the map
  const placedOffloads = offloads.filter(o => o.port_lat != null && o.port_lon != null)

  // One marker per distinct port, with the calls that landed there
  const portsByCode = {}
  for (const o of placedOffloads) {
    if (!portsByCode[o.port_id]) {
      portsByCode[o.port_id] = { ...o, calls: [] }
    }
    portsByCode[o.port_id].calls.push(o)
  }
  const offloadPorts = Object.values(portsByCode)

  const noVesselsTracked = !selectedVessel && includedIds && includedIds.size === 0
  const rangeLabel = timeframeLabel({ days, customRange, earliestDate })
  const selectedEventHasNoLocation = selectedEvent && (selectedEvent.lat == null || selectedEvent.lon == null)
  const showTimeframeBar = !selectedVessel && !noVesselsTracked

  const applyCustomRange = () => {
    if (!draftFrom || !draftTo) return
    onCustomRangeChange({ from: draftFrom, to: draftTo })
  }

  return (
    <div className="map-wrapper">
      {showTimeframeBar && (
        <div className="map-timeframe-bar">
          <div className="map-timeframe-row">
            <span className="map-timeframe-label">Timeframe</span>
            <div className="map-timeframe-btns">
              {TIMEFRAME_PRESETS.map(r => (
                <button
                  key={r.label}
                  className={`range-btn ${!customRange && days === r.days ? 'range-btn--active' : ''}`}
                  onClick={() => onDaysChange(r.days)}
                >
                  {r.days === null ? allSinceLabel(earliestDate) : r.label}
                </button>
              ))}
            </div>
          </div>
          <div className="map-timeframe-row map-timeframe-row--custom">
            <span className="map-timeframe-label">Date range</span>
            <div className="map-timeframe-custom">
              <input
                type="date"
                value={draftFrom}
                max={draftTo || undefined}
                onChange={e => setDraftFrom(e.target.value)}
              />
              <span className="map-timeframe-custom-sep">to</span>
              <input
                type="date"
                value={draftTo}
                min={draftFrom || undefined}
                onChange={e => setDraftTo(e.target.value)}
              />
              <button
                className="map-timeframe-apply"
                disabled={!draftFrom || !draftTo}
                onClick={applyCustomRange}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="map-canvas">
      {loading && <div className="map-loading">Loading events…</div>}
      {noVesselsTracked && (
        <div className="map-empty-state">
          No vessels tracked — head to <strong>Fishing Vessel Tracking</strong> to select vessels.
        </div>
      )}
      {selectedEventHasNoLocation && (
        <div className="map-toast">No location recorded for this event.</div>
      )}
      <MapContainer
        center={[-55, 20]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        attributionControl={false}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          maxZoom={19}
        />
        <AttributionControl position="bottomright" prefix={false} />
        <MapFlyTo events={events} selectedVessel={selectedVessel} />
        <MapResizeSync />
        <SelectedEventLayer event={selectedEvent} />
        {events.map(e => (
          <CircleMarker
            key={e.event_id}
            center={[e.lat, e.lon]}
            radius={selectedVessel ? 5 : 3}
            pathOptions={{
              color:       colourFor(e.vessel_id),
              fillColor:   colourFor(e.vessel_id),
              fillOpacity: 0.75,
              weight:      0,
            }}
          >
            <Popup>
              <div className="map-popup">
                <strong>{e.vessel_name}</strong>
                <span>{fmt(e.start_time)}</span>
                {e.duration_hours && (
                  <span>{e.duration_hours.toFixed(1)} hrs</span>
                )}
                {e.fao_areas?.length > 0 && (
                  <span>FAO {e.fao_areas.join(', ')}</span>
                )}
                {e.auth_status === 'not_matching_relevant_public_authorization' && (
                  <span className="popup-warn">⚠ Not authorized</span>
                )}
                {onSelectVesselId && (
                  <button className="popup-detail-link" onClick={() => onSelectVesselId(e.vessel_id)}>
                    View vessel details →
                  </button>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
        {carrierEncounters.map(e => (
          <Marker key={e.event_id} position={[e.lat, e.lon]} icon={carrierIcon}>
            <Popup>
              <div className="map-popup">
                <strong>⚠ Potential transshipment</strong>
                <span>{e.vessel_name} met {e.encountered_vessel_name || 'carrier vessel'}</span>
                {e.encountered_vessel_flag && <span>Carrier flag: {e.encountered_vessel_flag}</span>}
                <span>{fmt(e.start_time)}</span>
                {e.duration_hours && <span>{e.duration_hours.toFixed(1)} hrs alongside</span>}
                {onSelectVesselId && (
                  <button className="popup-detail-link" onClick={() => onSelectVesselId(e.vessel_id)}>
                    View vessel details →
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {placedPortVisits.map(pv => (
          <Marker key={pv.event_id} position={[pv.port_lat, pv.port_lon]} icon={portVisitIcon}>
            <Popup>
              <div className="map-popup">
                <strong>⚓ Port landing</strong>
                <span>{pv.vessel_name} arrived {pv.port_name}{pv.port_flag ? `, ${pv.port_flag}` : ''}</span>
                <span>{fmt(pv.start_time)}</span>
                {onSelectVesselId && (
                  <button className="popup-detail-link" onClick={() => onSelectVesselId(pv.vessel_id)}>
                    View vessel details →
                  </button>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
        {placedOffloads.map(o => (
          <Polyline
            key={o.encounter_id}
            positions={[[o.encounter_lat, o.encounter_lon], [o.port_lat, o.port_lon]]}
            pathOptions={{ color: '#f59e0b', weight: 1, dashArray: '3 5', opacity: 0.55 }}
          />
        ))}
        {offloadPorts.map(p => (
          <Marker key={p.port_id} position={[p.port_lat, p.port_lon]} icon={portIcon}>
            <Popup>
              <div className="map-popup">
                <strong>⚓ {p.port_name}, {p.port_flag}</strong>
                <span>Likely offload point — {p.calls.length} transshipment{p.calls.length > 1 ? 's' : ''} led here</span>
                {p.calls.slice(0, 5).map(c => (
                  <span key={c.encounter_id}>
                    {c.carrier_name} · {fmt(c.encounter_time)} → arrived {fmt(c.port_arrival_time)}
                  </span>
                ))}
                {p.calls.length > 5 && <span>+ {p.calls.length - 5} more</span>}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      <div className="map-overlay">
        {selectedVessel
          ? `${events.length} events — ${selectedVessel.vessel_name}`
          : `${events.length} events — ${rangeLabel} (${includedIds ? includedIds.size : 'all'} tracked vessels)`}
      </div>
      {(carrierEncounters.length > 0 || offloadPorts.length > 0 || placedPortVisits.length > 0) && (
        <div className="map-legend">
          {carrierEncounters.length > 0 && (
            <span className="map-legend-item">
              <span className="carrier-marker-diamond" /> Potential transshipment ({carrierEncounters.length})
            </span>
          )}
          {offloadPorts.length > 0 && (
            <span className="map-legend-item">
              <span className="port-marker-square" /> Likely offload port ({offloadPorts.length})
            </span>
          )}
          {placedPortVisits.length > 0 && (
            <span className="map-legend-item">
              <span className="port-visit-marker-triangle" /> Port landing ({placedPortVisits.length})
            </span>
          )}
        </div>
      )}
      </div>
    </div>
  )
}
