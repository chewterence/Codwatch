// Shared timeframe presets + param-building for the Fleet Intelligence view.
// A custom date range (when set) always takes precedence over the day preset.

export const TIMEFRAME_PRESETS = [
  { days: 7,    label: 'Past 1 week'   },
  { days: 30,   label: 'Past 1 month'  },
  { days: 180,  label: 'Past 6 months' },
  { days: 365,  label: 'Past 1 year'   },
  { days: 730,  label: 'Past 2 years'  },
  { days: null, label: 'All'           }, // display label is overridden with "All since <year>" once the earliest data date is known
]

// Appends the right timeframe query params onto a URLSearchParams in place.
// Only applies when no single vessel is selected — a selected vessel always
// shows its own full history, same as before this feature existed.
export function applyTimeframeParams(params, { selectedVessel, days, customRange }) {
  if (selectedVessel) return
  if (customRange?.from && customRange?.to) {
    params.set('start_date', customRange.from)
    params.set('end_date', customRange.to)
  } else if (days) {
    params.set('days', days)
  }
}

export function allSinceLabel(earliestDate) {
  const year = earliestDate ? new Date(earliestDate).getFullYear() : null
  return year ? `All since ${year}` : 'All'
}

export function timeframeLabel({ days, customRange, earliestDate }) {
  if (customRange?.from && customRange?.to) {
    return `${customRange.from} – ${customRange.to}`
  }
  if (days == null) {
    return allSinceLabel(earliestDate)
  }
  return TIMEFRAME_PRESETS.find(r => r.days === days)?.label ?? 'All'
}

// The concrete {from, to} date range a preset currently represents — "today"
// for the end, "today - N days" (or the earliest data date, for "All") for
// the start. Used to keep the date-range inputs showing real dates that
// match whichever preset is active.
function toDateInput(date) {
  return date.toISOString().slice(0, 10)
}

export function presetDateRange(daysValue, earliestDate) {
  const today = new Date()
  const to = toDateInput(today)

  if (daysValue == null) {
    const from = earliestDate ? toDateInput(new Date(earliestDate)) : ''
    return { from, to }
  }

  const fromDate = new Date(today)
  fromDate.setDate(fromDate.getDate() - daysValue)
  return { from: toDateInput(fromDate), to }
}
