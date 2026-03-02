/**
 * Converts a moment.js format string into a regex pattern with named capture groups
 * for extracting year, month, and day from file paths.
 */

export interface NoteFormatPattern {
  /** The compiled regex to match against relative file paths (without .md extension), anchored with ^...$ */
  regex: RegExp;
  /** Same pattern without anchors, for substring matching (e.g., unconfigured calendar detection) */
  unanchoredRegex: RegExp;
  /** Indices of capture groups: which group is year, month, day */
  yearGroup: number;
  monthGroup: number;
  dayGroup: number;
}

/**
 * Known moment.js tokens, ordered longest-first for greedy matching.
 * Each entry: [token, regex fragment, capture type or null]
 */
const MOMENT_TOKENS: [string, string, 'year' | 'month' | 'day' | null][] = [
  ['YYYY', '(\\d{4})', 'year'],
  ['YY',   '(\\d{2})', 'year'],
  ['MMMM', '\\w+',     null],
  ['MMM',  '\\w+',     null],
  ['MM',   '(\\d{2})', 'month'],
  ['Mo',   '\\w+',     null],
  ['M',    '(\\d{1,2})', 'month'],
  ['dddd', '\\w+',     null],
  ['ddd',  '\\w+',     null],
  ['dd',   '\\w+',     null],
  ['Do',   '\\w+',     null],
  ['DD',   '(\\d{2})', 'day'],
  ['D',    '(\\d{1,2})', 'day'],
  ['d',    '\\d',      null],
];

/**
 * Build a regex pattern from a moment.js format string.
 *
 * Scans the format left-to-right, greedily matching known tokens (longest first),
 * building a regex with capture groups for year/month/day.
 *
 * Returns null if the format doesn't contain all three required captures (year+month+day).
 */
export function buildNoteFormatPattern(format: string): NoteFormatPattern | null {
  let regexStr = '';
  let groupIndex = 0;
  let yearGroup = -1;
  let monthGroup = -1;
  let dayGroup = -1;

  let i = 0;
  while (i < format.length) {
    // Try to match a known token at current position (longest first)
    let matched = false;
    for (const [token, pattern, captureType] of MOMENT_TOKENS) {
      if (format.substring(i, i + token.length) === token) {
        regexStr += pattern;
        if (captureType) {
          groupIndex++;
          if (captureType === 'year' && yearGroup === -1) yearGroup = groupIndex;
          if (captureType === 'month' && monthGroup === -1) monthGroup = groupIndex;
          if (captureType === 'day' && dayGroup === -1) dayGroup = groupIndex;
        }
        i += token.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const ch = format[i];
      if (ch === ' ') {
        regexStr += '\\s+';
      } else {
        // Escape regex special chars
        regexStr += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      }
      i++;
    }
  }

  // Validate: must have all three captures
  if (yearGroup === -1 || monthGroup === -1 || dayGroup === -1) {
    return null;
  }

  return {
    regex: new RegExp('^' + regexStr + '$'),
    unanchoredRegex: new RegExp(regexStr),
    yearGroup,
    monthGroup,
    dayGroup,
  };
}

/**
 * Extract year, month, day from a regex match using a NoteFormatPattern.
 * Returns a Date (UTC) or null if parsing fails.
 */
export function extractDateFromMatch(match: RegExpMatchArray, pattern: NoteFormatPattern): Date | null {
  const yearStr = match[pattern.yearGroup];
  const monthStr = match[pattern.monthGroup];
  const dayStr = match[pattern.dayGroup];

  if (!yearStr || !monthStr || !dayStr) return null;

  let year = parseInt(yearStr, 10);
  // Handle 2-digit year (assume 2000s for YY)
  if (yearStr.length === 2) {
    year += 2000;
  }
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Common note formats to probe when detecting unconfigured calendars.
 * Used by getUnconfiguredCalendarRoot().
 */
export const COMMON_NOTE_FORMATS = [
  'YYYY/MM. MMM/DD ddd',   // e.g., 2025/01. Jan/15 Mon
  'YYYY-MM-DD',            // e.g., 2025-01-15
  'YYYY/MM/DD',            // e.g., 2025/01/15
  'YYYY/MM-DD',            // e.g., 2025/01-15
  'YYYY/MM/YYYY-MM-DD',   // e.g., 2025/01/2025-01-15
  'YYYY/YYYY-MM-DD',      // e.g., 2025/2025-01-15
];
