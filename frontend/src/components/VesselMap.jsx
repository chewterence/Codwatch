import { useEffect } from 'react'
import { MapContainer, TileLayer, AttributionControl, CircleMarker, useMap } from 'react-leaflet'
import L from 'leaflet'
import './VesselMap.css'

// Flies to and marks whichever segment was clicked in the Voyage Timeline. A
// segment can be a merged period spanning many underlying events (e.g. a
// 96-day, 210-event fishing run) — rather than picking one arbitrary point
// to represent it, every constituent point is plotted and the map fits to
// their combined bounds, so the shape of the cluster itself is visible.
//
// The popup is opened imperatively straight on the map (rather than via
// react-leaflet's <Marker><Popup> binding) because that binding's "open on
// mount" only works via a ref that races react-leaflet's own effect that
// actually attaches the marker layer to the map — the ref fires before the
// marker has a map to open a popup on, so it silently no-ops.
function SelectedLocationLayer({ location }) {
  const map = useMap()

  useEffect(() => {
    if (!location?.points?.length) return

    // Zoomed out enough to keep neighbouring countries in view rather than
    // filling the map with a single close-up dot — the point is to show
    // where in the world the vessel was, not to pinpoint it street-level.
    const latLngs = location.points.map(p => [p.lat, p.lon])
    if (latLngs.length === 1) {
      map.flyTo(latLngs[0], 4, { duration: 1.2 })
    } else {
      map.flyToBounds(L.latLngBounds(latLngs), { padding: [60, 60], maxZoom: 5, duration: 1.2 })
    }

    const content = document.createElement('div')
    content.className = 'map-popup'
    const title = document.createElement('strong')
    title.textContent = location.activity
    content.append(title)
    if (location.date) {
      const date = document.createElement('span')
      date.textContent = location.date
      content.append(date)
    }
    if (latLngs.length > 1) {
      const count = document.createElement('span')
      count.className = 'map-popup-muted'
      count.textContent = `${latLngs.length} points`
      content.append(count)
    }

    const center = L.latLngBounds(latLngs).getCenter()
    // className themes the whole popup chrome (background + tip), not just
    // the text inside it — see the vessel-popup--<kind> rules in
    // VesselMap.css that recolor .leaflet-popup-content-wrapper/-tip.
    const popup = L.popup({ offset: [0, -6], className: `vessel-popup vessel-popup--${location.kind || 'fishing'}` })
      .setLatLng(center)
      .setContent(content)
      .openOn(map)

    return () => { map.closePopup(popup) }
  }, [location, map])

  if (!location?.points?.length) return null

  return (
    <>
      {location.points.map((p, i) => (
        <CircleMarker
          key={i}
          center={[p.lat, p.lon]}
          radius={5}
          pathOptions={{
            color: location.color || '#3b82f6',
            fillColor: location.color || '#3b82f6',
            fillOpacity: 0.85,
            weight: 1.5,
            // Pulses to read as "this is where the vessel is right now",
            // distinct from the plain dots used for historical segments.
            className: location.kind === 'latest' ? 'vessel-marker-live' : undefined,
          }}
        />
      ))}
    </>
  )
}

// The map container's size can change after Leaflet's initial measurement
// (flex layout settles after mount), which otherwise leaves tiles blank.
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

// Fits the whole world into whatever the container's actual aspect ratio
// turns out to be, rather than a hand-picked center/zoom. Latitude is capped
// at ±66 rather than the full ±85 Mercator extent — the map panel is a wide
// rectangle, and fitting the full pole-to-pole range (near-square) into a
// wide box makes Leaflet zoom out until height fits, leaving the box far
// wider than one world is wide, which it then fills by repeating the world
// sideways. Capping latitude to roughly match the panel's own aspect ratio
// fits the full 360° of longitude in one pass with no repeats.
const WORLD_BOUNDS = [[-66, -180], [66, 180]]

// MapContainer only reads center/zoom/bounds once, at the moment the Leaflet
// map is created — VesselDetail doesn't render this component at all until
// the timeline has loaded and the initial "latest activity" location is
// already known (see VesselDetail's loading/selectedLocation state), so
// that location is available on VesselMap's very first render. Using it
// directly here means the map is born already framed on it — no initial
// world-view flash that then races an async flyTo to correct itself.
function initialView(location) {
  if (!location?.points?.length) return { bounds: WORLD_BOUNDS }
  const latLngs = location.points.map(p => [p.lat, p.lon])
  if (latLngs.length === 1) return { center: latLngs[0], zoom: 4 }
  return { bounds: latLngs, boundsOptions: { padding: [60, 60], maxZoom: 5 } }
}

export default function VesselMap({ location }) {
  return (
    <div className="vessel-map-section">
      <div className="vessel-map-title">Vessel Activity Map</div>
      <div className="vessel-map-canvas">
        <MapContainer
          {...initialView(location)}
          // Default zoom snaps to whole integers, so fitBounds can only pick
          // z=1 or z=2 — when the ideal fit is something like z=1.99 it's
          // forced down to z=1 (since z=2 would slightly overflow), leaving
          // a gap on the sides that gets filled by repeating the world.
          // Fractional zoom lets it land on the actual best-fit level.
          zoomSnap={0.25}
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
          <MapResizeSync />
          <SelectedLocationLayer location={location} />
        </MapContainer>
      </div>
    </div>
  )
}
