// Country name (as returned by the API) → flag emoji.
// Falls back to a white flag for any country not yet mapped here.
export const FLAG_EMOJI = {
  Argentina:            '🇦🇷',
  Australia:            '🇦🇺',
  Chile:                '🇨🇱',
  China:                '🇨🇳',
  France:               '🇫🇷',
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
