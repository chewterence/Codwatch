import { useState, useEffect, useRef } from 'react'
import VesselTracker from './components/VesselTracker'
import FleetMap from './components/FleetMap'
import EventsPanel from './components/EventsPanel'
import VesselDetail from './components/VesselDetail'
import SeasonOutlook from './components/SeasonOutlook'
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
  const [activeView, setActiveView]         = useState('tracker')
  const [includedIds, setIncludedIds]       = useState(new Set())
  const [statsExpanded, setStatsExpanded]   = useState(false)
  const [selectedEvent, setSelectedEvent]   = useState(null)
  const [days, setDays]                     = useState(180)
  const [customRange, setCustomRange]       = useState(null)
  const hydrated = useRef(false)

  // A day-preset and a custom date range are mutually exclusive.
  const handleDaysChange = (d) => {
    setCustomRange(null)
    setDays(d)
  }
  const handleCustomRangeChange = (range) => {
    setCustomRange(range)
  }

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
    setSelectedEvent(null)
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
    setSelectedEvent(null)
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
            Fishing Vessel Tracking
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
            Season Outlook
          </button>
        </nav>

        <div className="topbar-stats">
          {statsExpanded && (
            summary ? (
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
            )
          )}
          <button
            className="stats-toggle"
            onClick={() => setStatsExpanded(e => !e)}
            title={statsExpanded ? 'Hide fleet stats' : 'Show fleet stats'}
          >
            <span className={`stats-toggle-icon ${statsExpanded ? 'stats-toggle-icon--expanded' : ''}`}>▸</span>
            Stats
          </button>
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
            <SeasonOutlook includedIds={includedIds} vessels={vessels} onGoToTracker={() => handleViewChange('tracker')} onSelectVessel={handleVesselSelect} />
          </div>
        )}
        {activeView === 'fleet' && (
          <div className="main-panel">
            {showDetail ? (
              <VesselDetail vessel={selectedVessel} onBack={handleBack} />
            ) : (
              <div className="fleet-layout">
                <EventsPanel
                  selectedVessel={selectedVessel}
                  includedIds={includedIds}
                  onSelectVesselId={handleSelectVesselId}
                  selectedEvent={selectedEvent}
                  onSelectEvent={setSelectedEvent}
                  days={days}
                  customRange={customRange}
                  onGoToTracker={() => handleViewChange('tracker')}
                />
                <FleetMap
                  selectedVessel={selectedVessel}
                  includedIds={includedIds}
                  onSelectVesselId={handleSelectVesselId}
                  selectedEvent={selectedEvent}
                  days={days}
                  onDaysChange={handleDaysChange}
                  customRange={customRange}
                  onCustomRangeChange={handleCustomRangeChange}
                  earliestDate={summary?.first_event_date}
                  onGoToTracker={() => handleViewChange('tracker')}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
