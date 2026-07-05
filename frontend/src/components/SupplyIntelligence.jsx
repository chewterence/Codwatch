import { useState, useEffect } from 'react'
import {
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { flagFor } from '../flags'
import './SupplyIntelligence.css'

const MONTH_LABELS = ['Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']

const SEASON_COLORS = {
  '2022': '#4b5563',
  '2023': '#6366f1',
  '2024': '#8b5cf6',
  '2025': '#3b82f6',
}

function getTodayBucket(granularity) {
  const today = new Date()
  const month = today.getMonth() + 1
  const year = today.getFullYear()
  const seasonYear = month >= 12 ? year : year - 1
  const seasonStart = new Date(seasonYear, 11, 1)
  if (granularity === 'monthly') {
    return month >= 12 ? month - 11 : month + 1
  }
  const days = Math.floor((today - seasonStart) / 86400000)
  return Math.floor(days / 7) + 1
}

function fmtTodayLabel() {
  return new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
}

function seasonLabel(year) {
  const y = String(year)
  return `${y.slice(2)}/${String(Number(y) + 1).slice(2)}`
}

// Calendar date range for a season-relative week bucket, anchored to the
// current season's Dec 1 start (bucket 1 = days 1–7 after Dec 1).
function weekDateRange(bucket, seasonYear) {
  const year  = Number(seasonYear)
  const start = new Date(year, 11, 1 + (bucket - 1) * 7)
  const end   = new Date(year, 11, 1 + (bucket - 1) * 7 + 6)
  const short = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
  const full  = (d) => d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
  return start.getFullYear() === end.getFullYear()
    ? `${short(start)} – ${full(end)}`
    : `${full(start)} – ${full(end)}`
}

// Derive cumulative data from raw periodic data on the frontend
function computeCumulative(rawData, seasons) {
  const running = {}
  return rawData.map(row => {
    const out = { bucket: row.bucket }
    for (const year of seasons) {
      if (row[year] !== undefined) {
        running[year] = (running[year] ?? 0) + row[year]
      }
      if ((running[year] ?? 0) > 0) {
        out[year] = Math.round((running[year] ?? 0) * 10) / 10
      }
    }
    return out
  })
}

// Strip the current season's value from any bucket beyond today
function truncateToday(data, currentSeason, todayBucket) {
  return data.map(row => {
    if (row.bucket > todayBucket && currentSeason in row) {
      const { [currentSeason]: _drop, ...rest } = row
      return rest
    }
    return row
  })
}

function CustomTooltip({ active, payload, label, granularity, currentSeason }) {
  if (!active || !payload?.length) return null
  const isWeekly = granularity === 'weekly'
  const xLabel = isWeekly ? `Week ${label}` : MONTH_LABELS[label - 1]
  const dateRange = isWeekly && currentSeason ? weekDateRange(label, currentSeason) : null
  return (
    <div className="si-tooltip">
      <div className="si-tooltip-head">
        {xLabel}
        {dateRange && <span className="si-tooltip-daterange">{dateRange}</span>}
      </div>
      {payload.map(p => (
        <div key={p.dataKey} className="si-tooltip-row">
          <span className="si-tooltip-dot" style={{ background: p.color }} />
          <span className="si-tooltip-season">{seasonLabel(p.dataKey)}</span>
          <span className="si-tooltip-val">{Number(p.value).toLocaleString()}h</span>
        </div>
      ))}
    </div>
  )
}

function VesselListPanel({ vessels }) {
  const sorted = [...vessels].sort((a, b) => a.vessel_name.localeCompare(b.vessel_name))
  return (
    <div className="si-vessel-panel">
      <div className="si-vessel-panel-header">
        Tracked Vessels
        <span className="si-vessel-panel-count">{sorted.length}</span>
      </div>
      <div className="si-vessel-panel-list">
        {sorted.map(v => (
          <div key={v.id} className="si-vessel-item">
            <span className="si-vessel-flag">{flagFor(v.flag)}</span>
            <span className="si-vessel-name">{v.vessel_name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const sharedXAxis = (formatter, weekly) => ({
  dataKey: 'bucket',
  tickFormatter: formatter,
  tick: { fill: '#475569', fontSize: 11 },
  axisLine: { stroke: '#1e2240' },
  tickLine: false,
  interval: weekly ? 3 : 0,
})

const sharedYAxis = (formatter) => ({
  tickFormatter: formatter,
  tick: { fill: '#475569', fontSize: 11 },
  axisLine: false,
  tickLine: false,
  width: 44,
})

export default function SupplyIntelligence({ includedIds, vessels }) {
  const [species, setSpecies]           = useState('all')
  const [granularity, setGranularity]   = useState('monthly')
  const [rawData, setRawData]           = useState(null)
  const [loading, setLoading]           = useState(true)
  const [hiddenSeasons, setHiddenSeasons] = useState(new Set())

  const noVesselsTracked = includedIds && includedIds.size === 0
  const trackedVessels   = vessels ? vessels.filter(v => includedIds?.has(v.id)) : []

  const toggleSeason = (year) => {
    setHiddenSeasons(prev => {
      const next = new Set(prev)
      next.has(year) ? next.delete(year) : next.add(year)
      return next
    })
  }

  useEffect(() => {
    if (noVesselsTracked) {
      setRawData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const vidParam = includedIds ? `&vessel_ids=${[...includedIds].join(',')}` : ''
    fetch(`/api/supply/season-chart?species=${species}&granularity=${granularity}${vidParam}`)
      .then(r => r.json())
      .then(d => { setRawData(d); setLoading(false) })
  }, [species, granularity, includedIds, noVesselsTracked])

  const seasons       = rawData?.seasons ?? []
  const currentSeason = seasons[seasons.length - 1]
  const todayBucket   = getTodayBucket(granularity)
  const isWeekly      = granularity === 'weekly'
  const base          = rawData?.data ?? []

  const periodicData   = truncateToday(base, currentSeason, todayBucket)
  const cumulativeData = truncateToday(computeCumulative(base, seasons), currentSeason, todayBucket)

  const xFmt = isWeekly ? (v) => `W${v}` : (v) => MONTH_LABELS[v - 1] ?? ''
  const todayLine = (
    <ReferenceLine
      x={todayBucket}
      stroke="#f59e0b"
      strokeDasharray="4 4"
      strokeWidth={1.5}
      label={{ value: `Today · ${fmtTodayLabel()}`, position: 'insideTopRight', fill: '#f59e0b', fontSize: 10, fontWeight: 600, offset: 6 }}
    />
  )

  return (
    <div className="si-wrap">

      {/* ── Header ── */}
      <div className="si-header">
        <span className="si-title">Supply Intelligence</span>
        <div className="si-controls">
          <div className="si-toggle-group">
            {['all', 'eleginoides', 'mawsoni'].map(s => (
              <button key={s} className={`si-toggle ${species === s ? 'si-toggle--active' : ''}`} onClick={() => setSpecies(s)}>
                {s === 'all' ? 'All species' : s === 'eleginoides' ? 'D. eleginoides' : 'D. mawsoni'}
              </button>
            ))}
          </div>
          <div className="si-toggle-group">
            {['monthly', 'weekly'].map(g => (
              <button key={g} className={`si-toggle ${granularity === g ? 'si-toggle--active' : ''}`} onClick={() => setGranularity(g)}>
                {g === 'monthly' ? 'Monthly' : 'Weekly'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Season toggles ── */}
      {!loading && seasons.length > 0 && (
        <div className="si-legend-strip">
          {seasons.map(year => {
            const hidden = hiddenSeasons.has(year)
            const color  = SEASON_COLORS[year] ?? '#94a3b8'
            return (
              <button
                key={year}
                className={`si-legend-item ${hidden ? 'si-legend-item--hidden' : ''}`}
                onClick={() => toggleSeason(year)}
                title={hidden ? `Show ${seasonLabel(year)}` : `Hide ${seasonLabel(year)}`}
              >
                <span className="si-legend-icon" style={{ background: color }} />
                <span className="si-legend-label" style={{ color }}>{seasonLabel(year)}</span>
              </button>
            )
          })}
        </div>
      )}

      {noVesselsTracked ? (
        <div className="si-empty-state">No vessels tracked — head to <strong>Fishing Vessel Tracking</strong> to select vessels.</div>
      ) : (
        <div className="si-body">
          {loading ? (
            <div className="si-loading">Loading…</div>
          ) : (
          <div className="si-charts">

          {/* ── Top: periodic bar chart ── */}
          <div className="si-chart-section">
            <div className="si-chart-label">
              {isWeekly ? 'Weekly' : 'Monthly'} Fishing Hours
              <span className="si-chart-sublabel">hours per {isWeekly ? 'week' : 'month'} — higher = more active fishing</span>
            </div>
            <div className="si-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={periodicData} margin={{ top: 8, right: 32, bottom: 4, left: 8 }} barCategoryGap="30%" barGap={1}>
                  <CartesianGrid stroke="#1e2240" strokeDasharray="4 4" vertical={false} />
                  <XAxis {...sharedXAxis(xFmt, isWeekly)} />
                  <YAxis {...sharedYAxis(v => `${(v / 1000).toFixed(1)}k`)} />
                  <Tooltip content={<CustomTooltip granularity={granularity} currentSeason={currentSeason} />} />
                  {todayLine}
                  {seasons.map(year => (
                    <Bar
                      key={year}
                      dataKey={year}
                      fill={SEASON_COLORS[year] ?? '#94a3b8'}
                      radius={[2, 2, 0, 0]}
                      maxBarSize={isWeekly ? 5 : 18}
                      opacity={year === currentSeason ? 1 : 0.65}
                      hide={hiddenSeasons.has(year)}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="si-chart-divider" />

          {/* ── Bottom: cumulative line chart ── */}
          <div className="si-chart-section">
            <div className="si-chart-label">
              Cumulative Season Hours
              <span className="si-chart-sublabel">running total since Dec 1 — shows if this season is ahead or behind</span>
            </div>
            <div className="si-chart-area">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={cumulativeData} margin={{ top: 8, right: 32, bottom: 4, left: 8 }}>
                  <CartesianGrid stroke="#1e2240" strokeDasharray="4 4" vertical={false} />
                  <XAxis {...sharedXAxis(xFmt, isWeekly)} />
                  <YAxis {...sharedYAxis(v => `${(v / 1000).toFixed(0)}k`)} />
                  <Tooltip content={<CustomTooltip granularity={granularity} currentSeason={currentSeason} />} />
                  {todayLine}
                  {seasons.map(year => (
                    <Line
                      key={year}
                      dataKey={year}
                      stroke={SEASON_COLORS[year] ?? '#94a3b8'}
                      strokeWidth={year === currentSeason ? 2.5 : 1.5}
                      dot={false}
                      connectNulls={false}
                      hide={hiddenSeasons.has(year)}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          </div>
          )}
          <VesselListPanel vessels={trackedVessels} />
        </div>
      )}
    </div>
  )
}
