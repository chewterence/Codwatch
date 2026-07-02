import { useState, useEffect } from 'react'
import VesselSidebar from './components/VesselSidebar'
import FleetMap from './components/FleetMap'
import EventsPanel from './components/EventsPanel'
import VesselDetail from './components/VesselDetail'
import SupplyIntelligence from './components/SupplyIntelligence'
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
  const [summary, setSummary]               = useState(null)
  const [vessels, setVessels]               = useState([])
  const [selectedVessel, setSelectedVessel] = useState(null)
  const [detailMode, setDetailMode]         = useState(false)
  const [activeTab, setActiveTab]           = useState('fishing')
  const [activeView, setActiveView]         = useState('fleet')
  const [includedIds, setIncludedIds]       = useState(new Set())

  useEffect(() => {
    fetch('/api/summary').then(r => r.json()).then(setSummary)
    fetch('/api/vessels').then(r => r.json()).then(data => {
      setVessels(data)
      setIncludedIds(new Set(data.filter(v => v.gfw_vessel_id).map(v => v.id)))
    })
  }, [])

  const handleToggleInclude = (vesselId) => {
    setIncludedIds(prev => {
      const next = new Set(prev)
      if (next.has(vesselId)) next.delete(vesselId)
      else next.add(vesselId)
      return next
    })
  }

  const handleSetIncluded = (vesselIds) => {
    setIncludedIds(new Set(vesselIds))
  }

  const handleVesselSelect = (vessel) => {
    setSelectedVessel(vessel)
    setDetailMode(true)
  }

  const handleBack = () => {
    setSelectedVessel(null)
    setDetailMode(false)
  }

  const handleViewChange = (view) => {
    setActiveView(view)
    if (view !== 'fleet') {
      setSelectedVessel(null)
      setDetailMode(false)
    }
  }

  const showDetail = detailMode && selectedVessel && activeView === 'fleet'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-dot" />
          CODWATCH
        </div>

        <nav className="topbar-nav">
          <button
            className={`nav-tab ${activeView === 'fleet' ? 'nav-tab--active' : ''}`}
            onClick={() => handleViewChange('fleet')}
          >
            Fleet Intelligence
          </button>
          <button
            className={`nav-tab ${activeView === 'supply' ? 'nav-tab--active' : ''}`}
            onClick={() => handleViewChange('supply')}
          >
            Supply Intelligence
          </button>
        </nav>

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
      </header>

      <div className="workspace">
        {activeView === 'fleet' && (
          <VesselSidebar
            vessels={vessels}
            selected={selectedVessel}
            onSelect={handleVesselSelect}
            includedIds={includedIds}
            onToggleInclude={handleToggleInclude}
            onSetIncluded={handleSetIncluded}
          />
        )}
        <div className="main-panel">
          {activeView === 'supply' ? (
            <SupplyIntelligence />
          ) : showDetail ? (
            <VesselDetail vessel={selectedVessel} onBack={handleBack} />
          ) : (
            <>
              <FleetMap selectedVessel={selectedVessel} includedIds={includedIds} />
              <EventsPanel
                selectedVessel={selectedVessel}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
