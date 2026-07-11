import { useEffect } from 'react'
import { MapContainer, TileLayer, AttributionControl, useMap } from 'react-leaflet'
import './VesselMap.css'

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

export default function VesselMap() {
  return (
    <div className="vessel-map-section">
      <div className="vessel-map-title">Vessel Activity Map</div>
      <div className="vessel-map-canvas">
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
          <MapResizeSync />
        </MapContainer>
      </div>
    </div>
  )
}
