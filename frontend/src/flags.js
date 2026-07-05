// Country name (as returned by the API) → flag emoji.
// Falls back to a white flag for any country not yet mapped here.
export const FLAG_EMOJI = {
  Argentina:            '🇦🇷',
  Australia:            '🇦🇺',
  Chile:                '🇨🇱',
  China:                '🇨🇳',
  France:               '🇫🇷',
  Iceland:               '🇮🇸',
  Japan:                '🇯🇵',
  'Korea, Republic of': '🇰🇷',
  Namibia:              '🇳🇦',
  'New Zealand':        '🇳🇿',
  'Russian Federation': '🇷🇺',
  SHN:                  '🇸🇭', // Saint Helena
  'South Africa':       '🇿🇦',
  Spain:                '🇪🇸',
  Ukraine:              '🇺🇦',
  'United Kingdom':     '🇬🇧',
  Uruguay:              '🇺🇾',
}

export function flagFor(country) {
  return FLAG_EMOJI[country] || '🏳️'
}

// ISO3 → { iso2, name } for all port_flag values that appear in the database
export const PORT_FLAG = {
  AGO: { iso2:'AO', name:'Angola' },
  ARG: { iso2:'AR', name:'Argentina' },
  ATA: { iso2:'AQ', name:'Antarctica' },
  ATF: { iso2:'TF', name:'French Southern Territories' },
  AUS: { iso2:'AU', name:'Australia' },
  BRA: { iso2:'BR', name:'Brazil' },
  CAN: { iso2:'CA', name:'Canada' },
  CHL: { iso2:'CL', name:'Chile' },
  CHN: { iso2:'CN', name:'China' },
  CIV: { iso2:'CI', name:'Côte d\'Ivoire' },
  COD: { iso2:'CD', name:'DR Congo' },
  CPV: { iso2:'CV', name:'Cape Verde' },
  ESP: { iso2:'ES', name:'Spain' },
  FJI: { iso2:'FJ', name:'Fiji' },
  FLK: { iso2:'FK', name:'Falkland Islands' },
  FRA: { iso2:'FR', name:'France' },
  GBR: { iso2:'GB', name:'United Kingdom' },
  GHA: { iso2:'GH', name:'Ghana' },
  GNB: { iso2:'GW', name:'Guinea-Bissau' },
  IND: { iso2:'IN', name:'India' },
  JPN: { iso2:'JP', name:'Japan' },
  KOR: { iso2:'KR', name:'South Korea' },
  MDG: { iso2:'MG', name:'Madagascar' },
  MOZ: { iso2:'MZ', name:'Mozambique' },
  MRT: { iso2:'MR', name:'Mauritania' },
  MUS: { iso2:'MU', name:'Mauritius' },
  NAM: { iso2:'NA', name:'Namibia' },
  NGA: { iso2:'NG', name:'Nigeria' },
  NOR: { iso2:'NO', name:'Norway' },
  NZL: { iso2:'NZ', name:'New Zealand' },
  PER: { iso2:'PE', name:'Peru' },
  PRT: { iso2:'PT', name:'Portugal' },
  REU: { iso2:'RE', name:'Réunion' },
  RUS: { iso2:'RU', name:'Russia' },
  SEN: { iso2:'SN', name:'Senegal' },
  SGS: { iso2:'GS', name:'South Georgia' },
  SHN: { iso2:'SH', name:'Saint Helena' },
  SYC: { iso2:'SC', name:'Seychelles' },
  TZA: { iso2:'TZ', name:'Tanzania' },
  UKR: { iso2:'UA', name:'Ukraine' },
  URY: { iso2:'UY', name:'Uruguay' },
  USA: { iso2:'US', name:'United States' },
  ZAF: { iso2:'ZA', name:'South Africa' },
}

export function portFlagDisplay(iso3) {
  if (!iso3) return { emoji: '', name: iso3 }
  const entry = PORT_FLAG[iso3.toUpperCase()]
  if (!entry) return { emoji: '', name: iso3 }
  const emoji = [...entry.iso2].map(c => String.fromCodePoint(c.charCodeAt(0) + 0x1F1A5)).join('')
  return { emoji, name: entry.name }
}
