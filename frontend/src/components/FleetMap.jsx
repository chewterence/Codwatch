import { useEffect, useState, useRef } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet'
import './FleetMap.css'

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

export default function FleetMap({ selectedVessel }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: 800 })
    if (selectedVessel) params.set('vessel_id', selectedVessel.id)
    else params.set('days', 180)  // last 6 months when no vessel selected

    fetch(`/api/fishing-events?${params}`)
      .then(r => r.json())
      .then(data => { setEvents(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selectedVessel])

  return (
    <div className="map-wrapper">
      {loading && <div className="map-loading">Loading events…</div>}
      <MapContainer
        center={[-55, 20]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          maxZoom={19}
        />
        <MapFlyTo events={events} selectedVessel={selectedVessel} />
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
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
      <div className="map-overlay">
        {selectedVessel
          ? `${events.length} events — ${selectedVessel.vessel_name}`
          : `${events.length} events — last 6 months (all vessels)`}
      </div>
    </div>
  )
}
