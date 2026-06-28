import { useMemo } from 'react'
import './VoyageTimeline.css'

const GAP_THRESHOLD_DAYS = 10

function daysBetween(start, end) {
  if (!start || !end) return 0
  return Math.max(0, (new Date(end) - new Date(start)) / 86400000)
}

function fmtShort(isoStr) {
  if (!isoStr) return ''
  return new Date(isoStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
}

function formatFaoAreas(areas) {
  if (!areas?.length) return null
  const subareas = [...new Set(areas.filter(a => a.includes('.')))].sort()
  const display = subareas.length ? subareas : [...new Set(areas)].sort()
  return display.slice(0, 3).join(' · ')
}

function buildSegments(fishingEvents, portVisits) {
  if (!fishingEvents.length) return []

  const periods = []
  for (const e of fishingEvents) {
    const eEnd = e.end_time || e.start_time
    if (!periods.length) {
      periods.push({
        type: 'fishing',
        start: e.start_time,
        end: eEnd,
        fao_areas: [...(e.fao_areas || [])],
        event_count: 1,
        total_hours: e.duration_hours || 0,
      })
    } else {
      const last = periods[periods.length - 1]
      const gap = daysBetween(last.end, e.start_time)
      if (gap <= GAP_THRESHOLD_DAYS) {
        if (eEnd > last.end) last.end = eEnd
        last.event_count++
        last.total_hours += e.duration_hours || 0
        ;(e.fao_areas || []).forEach(a => {
          if (!last.fao_areas.includes(a)) last.fao_areas.push(a)
        })
      } else {
        periods.push({
          type: 'fishing',
          start: e.start_time,
          end: eEnd,
          fao_areas: [...(e.fao_areas || [])],
          event_count: 1,
          total_hours: e.duration_hours || 0,
        })
      }
    }
  }

  const segments = []
  for (let i = 0; i < periods.length; i++) {
    if (i > 0) {
      const gapStart = periods[i - 1].end
      const gapEnd   = periods[i].start
      const gapDays  = daysBetween(gapStart, gapEnd)

      const gapPorts = (portVisits || [])
        .filter(p => p.start_time >= gapStart && p.start_time <= gapEnd)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))

      if (gapPorts.length) {
        let cursor = gapStart
        for (const port of gapPorts) {
          const tDays = daysBetween(cursor, port.start_time)
          if (tDays >= 1) {
            segments.push({ type: 'transit', start: cursor, end: port.start_time, days: Math.round(tDays) })
          }
          segments.push({
            type: 'port',
            start: port.start_time,
            end: port.end_time || port.start_time,
            days: Math.max(1, Math.round(daysBetween(port.start_time, port.end_time || port.start_time))),
            port_name: port.port_name,
            port_flag: port.port_flag,
          })
          cursor = port.end_time || port.start_time
        }
        const remDays = daysBetween(cursor, gapEnd)
        if (remDays >= 1) {
          segments.push({ type: 'transit', start: cursor, end: gapEnd, days: Math.round(remDays) })
        }
      } else {
        segments.push({ type: 'transit', start: gapStart, end: gapEnd, days: Math.round(gapDays) })
      }
    }
    segments.push(periods[i])
  }

  return segments
}

function blockWidth(seg) {
  const days = seg.days ?? daysBetween(seg.start, seg.end)
  const MIN = seg.type === 'transit' ? 72 : 110
  return Math.max(MIN, Math.round(days * 4.5))
}

function FishingBlock({ seg }) {
  const days = Math.round(daysBetween(seg.start, seg.end))
  const area = formatFaoAreas(seg.fao_areas)
  return (
    <div className="seg seg--fishing" style={{ width: blockWidth(seg) }}>
      <div className="seg-header">
        <span className="seg-icon">🎣</span>
        <span className="seg-type-label">FISHING</span>
      </div>
      {area && <div className="seg-area">{area}</div>}
      <div className="seg-days">{days}d</div>
      <div className="seg-dates">{fmtShort(seg.start)} → {fmtShort(seg.end)}</div>
      <div className="seg-sub">{seg.event_count} events · {Math.round(seg.total_hours)}h</div>
    </div>
  )
}

function TransitBlock({ seg }) {
  return (
    <div className="seg seg--transit" style={{ width: blockWidth(seg) }}>
      <div className="seg-type-label seg-type-label--transit">TRANSIT</div>
      <div className="seg-days seg-days--transit">{seg.days}d</div>
      <div className="seg-dates">{fmtShort(seg.start)}</div>
    </div>
  )
}

function PortBlock({ seg }) {
  return (
    <div className="seg seg--port" style={{ width: blockWidth(seg) }}>
      <div className="seg-header">
        <span className="seg-icon">⚓</span>
        <span className="seg-type-label">PORT</span>
      </div>
      {seg.port_name && <div className="seg-area">{seg.port_name}</div>}
      {seg.port_flag && <div className="seg-sub">{seg.port_flag}</div>}
      <div className="seg-days seg-days--port">{seg.days}d</div>
      <div className="seg-dates">{fmtShort(seg.start)}</div>
    </div>
  )
}

function Segment({ seg }) {
  if (seg.type === 'fishing') return <FishingBlock seg={seg} />
  if (seg.type === 'transit') return <TransitBlock seg={seg} />
  if (seg.type === 'port')    return <PortBlock seg={seg} />
  return null
}

export default function VoyageTimeline({ fishingEvents, portVisits }) {
  const segments = useMemo(
    () => buildSegments(fishingEvents || [], portVisits || []),
    [fishingEvents, portVisits],
  )

  if (!fishingEvents?.length) {
    return <div className="timeline-empty">No fishing events recorded in this period.</div>
  }

  const fishSegs    = segments.filter(s => s.type === 'fishing')
  const transitSegs = segments.filter(s => s.type === 'transit')
  const portSegs    = segments.filter(s => s.type === 'port')
  const totalFishDays    = fishSegs.reduce((n, s) => n + daysBetween(s.start, s.end), 0)
  const totalTransitDays = transitSegs.reduce((n, s) => n + s.days, 0)

  return (
    <div className="voyage-timeline">
      <div className="timeline-topbar">
        <span className="timeline-label">Voyage Timeline</span>
        <div className="timeline-summary">
          <span className="tl-stat tl-stat--fish">
            🎣 {fishSegs.length} trips · {Math.round(totalFishDays)}d fishing
          </span>
          <span className="tl-stat tl-stat--transit">
            ⟳ {transitSegs.length} transits · {Math.round(totalTransitDays)}d
          </span>
          {portSegs.length > 0 && (
            <span className="tl-stat tl-stat--port">⚓ {portSegs.length} ports</span>
          )}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-track">
          {segments.map((seg, i) => (
            <div key={i} className="tl-item">
              {i > 0 && <div className="tl-arrow">→</div>}
              <Segment seg={seg} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
