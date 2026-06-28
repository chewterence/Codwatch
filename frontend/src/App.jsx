import { useState, useEffect } from 'react'
import VesselSidebar from './components/VesselSidebar'
import FleetMap from './components/FleetMap'
import EventsPanel from './components/EventsPanel'
import './App.css'

function StatBadge({ label, value, highlight }) {
  return (
    <div className={`stat-badge ${highlight ? 'stat-badge--highlight' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  )
}

export default function App() {
  const [summary, setSummary]             = useState(null)
  const [vessels, setVessels]             = useState([])
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [activeTab, setActiveTab]         = useState('fishing')

  useEffect(() => {
    fetch('/api/summary').then(r => r.json()).then(setSummary)
    fetch('/api/vessels').then(r => r.json()).then(setVessels)
  }, [])

  const handleVesselSelect = (vessel) => {
    setSelectedVessel(prev => prev?.id === vessel.id ? null : vessel)
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-dot" />
          CODWATCH
        </div>
        <div className="topbar-stats">
          {summary ? (
            <>
              <StatBadge label="Fleet" value={`${summary.tracked_vessels} / ${summary.total_vessels} vessels`} />
              <StatBadge label="Fishing Events" value={Number(summary.total_fishing_events).toLocaleString()} />
              <StatBadge label="Encounters" value={summary.total_encounters} />
              <StatBadge label="AIS Gaps" value={summary.total_ais_gaps} />
              <StatBadge label="Port Visits" value={summary.total_port_visits} />
              {summary.last_event_date && (
                <StatBadge label="Last Event" value={summary.last_event_date} highlight />
              )}
            </>
          ) : (
            <span className="loading-text">Loading...</span>
          )}
        </div>
        {selectedVessel && (
          <div className="topbar-selection">
            <span className="selection-label">Viewing:</span>
            <span className="selection-name">{selectedVessel.vessel_name}</span>
            <button className="clear-btn" onClick={() => setSelectedVessel(null)}>✕</button>
          </div>
        )}
      </header>

      <div className="workspace">
        <VesselSidebar
          vessels={vessels}
          selected={selectedVessel}
          onSelect={handleVesselSelect}
        />
        <div className="main-panel">
          <FleetMap selectedVessel={selectedVessel} />
          <EventsPanel
            selectedVessel={selectedVessel}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        </div>
      </div>
    </div>
  )
}
