import { useState, useEffect, useRef } from 'react'
import VesselTracker from './components/VesselTracker'
import FleetMap from './components/FleetMap'
import EventsPanel from './components/EventsPanel'
import VesselDetail from './components/VesselDetail'
import SupplyIntelligence from './components/SupplyIntelligence'
import './App.css'

const TRACKED_IDS_KEY = 'codwatch.trackedVesselIds'

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
  const [activeView, setActiveView]         = useState('tracker')
  const [includedIds, setIncludedIds]       = useState(new Set())
  const hydrated = useRef(false)

  useEffect(() => {
    fetch('/api/summary').then(r => r.json()).then(setSummary)
    fetch('/api/vessels').then(r => r.json()).then(data => {
      setVessels(data)
      const trackedIds = new Set(data.filter(v => v.gfw_vessel_id).map(v => v.id))

      let initial = trackedIds
      const stored = localStorage.getItem(TRACKED_IDS_KEY)
      if (stored) {
        try {
          const storedIds = JSON.parse(stored).filter(id => trackedIds.has(id))
          initial = new Set(storedIds)
        } catch { /* fall back to all-tracked default */ }
      }

      setIncludedIds(initial)
      hydrated.current = true
    })
  }, [])

  useEffect(() => {
    if (!hydrated.current) return
    localStorage.setItem(TRACKED_IDS_KEY, JSON.stringify([...includedIds]))
  }, [includedIds])

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
    setActiveView('fleet')
  }

  const handleSelectVesselId = (vesselId) => {
    const vessel = vessels.find(v => v.id === vesselId)
    if (vessel) handleVesselSelect(vessel)
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
            className={`nav-tab ${activeView === 'tracker' ? 'nav-tab--active' : ''}`}
            onClick={() => handleViewChange('tracker')}
          >
            Vessel Tracker
          </button>
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
        {activeView === 'tracker' && (
          <VesselTracker
            vessels={vessels}
            includedIds={includedIds}
            onToggleInclude={handleToggleInclude}
            onSetIncluded={handleSetIncluded}
            onViewDetail={handleVesselSelect}
          />
        )}
        {activeView === 'supply' && (
          <div className="main-panel">
            <SupplyIntelligence includedIds={includedIds} />
          </div>
        )}
        {activeView === 'fleet' && (
          <div className="main-panel">
            {showDetail ? (
              <VesselDetail vessel={selectedVessel} onBack={handleBack} />
            ) : (
              <>
                <FleetMap
                  selectedVessel={selectedVessel}
                  includedIds={includedIds}
                  onSelectVesselId={handleSelectVesselId}
                />
                <EventsPanel
                  selectedVessel={selectedVessel}
                  includedIds={includedIds}
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  onSelectVesselId={handleSelectVesselId}
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
