import { TFile, moment, Vault } from 'obsidian';
import { Timewalk, Waypoint, GroupWaypoint } from './timewalk';
import { CalendarSource } from './types';
import { NoteFormatPattern, buildNoteFormatPattern, extractDateFromMatch, COMMON_NOTE_FORMATS } from './note-format';

/**
 * Obsidian file wrapper implementing Waypoint interface
 */
export class ObsidianFileWaypoint implements Waypoint {
  constructor(
    private file: TFile,
    private fileDate: Date
  ) {}

  identifier(): string {
    return this.file.path;
  }

  time(): Date {
    return this.fileDate;
  }

  isContainer(): boolean {
    return false;
  }

  children(): Waypoint[] {
    return [];
  }

  getFile(): TFile {
    return this.file;
  }
}

/**
 * Result of getDailyNoteInfo: associates a file with its parsed date and calendar
 */
export interface DailyNoteInfo {
  date: moment.Moment;
  calendarId: string;
}

/**
 * Service for managing per-calendar timewalk instances with Obsidian daily notes
 */
export class TimewalkService {
  private calendarTimewalks: Map<string, Timewalk> = new Map();
  private calendarWaypointMaps: Map<string, Map<string, ObsidianFileWaypoint>> = new Map();
  private calendarPatterns: Map<string, NoteFormatPattern> = new Map();
  private calendars: CalendarSource[] = [];
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Rebuild all timewalk instances from current calendars
   */
  rebuild(calendars: CalendarSource[]): void {
    this.calendars = calendars;
    this.calendarTimewalks.clear();
    this.calendarWaypointMaps.clear();
    this.calendarPatterns.clear();

    const enabledCalendars = calendars.filter(c => c.enabled);
    const allFiles = this.vault.getMarkdownFiles();

    // Compile each calendar's noteFormat into a regex pattern
    for (const calendar of enabledCalendars) {
      const pattern = buildNoteFormatPattern(calendar.noteFormat);
      if (pattern) {
        this.calendarPatterns.set(calendar.id, pattern);
      } else {
        console.warn(`[Daily Orbit] Calendar "${calendar.name}" has invalid noteFormat: "${calendar.noteFormat}"`);
      }
    }

    for (const calendar of enabledCalendars) {
      const root = new GroupWaypoint(calendar.id);
      const waypointMap = new Map<string, ObsidianFileWaypoint>();
      const pattern = this.calendarPatterns.get(calendar.id);

      if (!pattern) {
        // No valid pattern — skip this calendar
        this.calendarTimewalks.set(calendar.id, new Timewalk(root));
        this.calendarWaypointMaps.set(calendar.id, waypointMap);
        continue;
      }

      // Filter files under this calendar's root folder
      const calendarFiles = allFiles.filter(file =>
        this.fileIsUnderRoot(file.path, calendar.rootFolder)
      );

      for (const file of calendarFiles) {
        // Get relative path without root folder prefix and .md extension
        const relativePath = this.getRelativePath(file.path, calendar.rootFolder);
        const pathWithoutExt = relativePath.replace(/\.md$/, '');
        const pathMatch = pathWithoutExt.match(pattern.regex);
        if (pathMatch) {
          const date = extractDateFromMatch(pathMatch, pattern);
          if (date) {
            const waypoint = new ObsidianFileWaypoint(file, date);
            root.addChild(waypoint);
            waypointMap.set(file.path, waypoint);
          }
        }
      }

      this.calendarTimewalks.set(calendar.id, new Timewalk(root));
      this.calendarWaypointMaps.set(calendar.id, waypointMap);
    }
  }

  /**
   * Get relative path by stripping the root folder prefix
   */
  private getRelativePath(filePath: string, rootFolder: string): string {
    if (!rootFolder) return filePath;
    const normalizedRoot = rootFolder.replace(/\/+$/, '');
    if (filePath.startsWith(normalizedRoot + '/')) {
      return filePath.substring(normalizedRoot.length + 1);
    }
    return filePath;
  }

  /**
   * Check if a file path is under a root folder
   */
  private fileIsUnderRoot(filePath: string, rootFolder: string): boolean {
    if (!rootFolder || rootFolder === "") {
      return true; // Empty root = vault root, matches everything
    }
    // Normalize: ensure rootFolder doesn't have trailing slash
    const normalizedRoot = rootFolder.replace(/\/+$/, '');
    return filePath.startsWith(normalizedRoot + '/') || filePath.startsWith(normalizedRoot + '\\');
  }

  /**
   * Check if a file is a daily note and return its date + calendarId
   */
  getDailyNoteInfo(file: TFile): DailyNoteInfo | null {
    // Check each calendar's waypoint map
    for (const [calendarId, waypointMap] of this.calendarWaypointMaps) {
      const waypoint = waypointMap.get(file.path);
      if (waypoint) {
        return {
          date: moment(waypoint.time()),
          calendarId,
        };
      }
    }

    // Fallback: try to parse from path using each calendar's pattern
    for (const calendar of this.calendars.filter(c => c.enabled)) {
      if (!this.fileIsUnderRoot(file.path, calendar.rootFolder)) continue;

      const pattern = this.calendarPatterns.get(calendar.id);
      if (!pattern) continue;

      const relativePath = this.getRelativePath(file.path, calendar.rootFolder);
      const pathWithoutExt = relativePath.replace(/\.md$/, '');
      const pathMatch = pathWithoutExt.match(pattern.regex);
      if (pathMatch) {
        const date = extractDateFromMatch(pathMatch, pattern);
        if (date) {
          const parsedDate = moment(date);
          if (parsedDate.isValid()) {
            return { date: parsedDate, calendarId: calendar.id };
          }
        }
      }
    }

    return null;
  }

  /**
   * Find the daily note file for a specific date within a calendar
   */
  findDailyNote(date: moment.Moment, calendarId: string): TFile | null {
    const timewalk = this.calendarTimewalks.get(calendarId);
    if (!timewalk) return null;

    const targetDate = date.toDate();
    const results = timewalk.find(targetDate);

    if (results.length > 0) {
      const waypoint = results[0] as ObsidianFileWaypoint;
      return waypoint.getFile();
    }
    return null;
  }

  /**
   * Check if a daily note exists for a date in a specific calendar
   */
  hasDailyNote(date: moment.Moment, calendarId: string): boolean {
    return this.findDailyNote(date, calendarId) !== null;
  }

  /**
   * Get the previous daily note before the given date within a calendar
   */
  getPreviousDailyNote(currentDate: moment.Moment, calendarId: string): TFile | null {
    const { waypoints, currentIndex } = this.getSortedWaypoints(currentDate, calendarId);

    if (currentIndex > 0) {
      return (waypoints[currentIndex - 1] as ObsidianFileWaypoint).getFile();
    }
    return null;
  }

  /**
   * Get the next daily note after the given date within a calendar
   */
  getNextDailyNote(currentDate: moment.Moment, calendarId: string): TFile | null {
    const { waypoints, currentIndex } = this.getSortedWaypoints(currentDate, calendarId);

    if (currentIndex !== -1 && currentIndex < waypoints.length - 1) {
      return (waypoints[currentIndex + 1] as ObsidianFileWaypoint).getFile();
    }
    return null;
  }

  /**
   * Get sorted waypoints and find current note's index for a specific calendar
   */
  private getSortedWaypoints(currentDate: moment.Moment, calendarId: string): { waypoints: Waypoint[], currentIndex: number } {
    const timewalk = this.calendarTimewalks.get(calendarId);
    if (!timewalk) return { waypoints: [], currentIndex: -1 };

    const waypoints: Waypoint[] = [];

    // Traverse in 'future' direction (oldest first) to get chronological order
    timewalk.traverse((waypoint) => {
      waypoints.push(waypoint);
    }, { direction: 'future', filter: 'leaves' });

    // Find current note's index
    const currentIndex = waypoints.findIndex(wp => {
      return this.isSameDay(wp.time(), currentDate.toDate());
    });

    return { waypoints, currentIndex };
  }

  /**
   * Helper to check if two dates are the same day
   */
  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  /**
   * Get the underlying timewalk instance for a specific calendar
   */
  getTimewalk(calendarId: string): Timewalk | undefined {
    return this.calendarTimewalks.get(calendarId);
  }

  /**
   * For unconfigured calendar detection:
   * If a file matches any common daily note format but doesn't fall under any configured calendar's rootFolder,
   * extract the path prefix before the date part and return it.
   */
  getUnconfiguredCalendarRoot(file: TFile): string | null {
    if (!file.path.endsWith('.md')) return null;

    // Check if it falls under any configured calendar's root folder
    for (const calendar of this.calendars.filter(c => c.enabled)) {
      if (this.fileIsUnderRoot(file.path, calendar.rootFolder)) {
        return null; // File belongs to a configured calendar, not unconfigured
      }
    }

    // Probe common formats against the file path
    const pathWithoutExt = file.path.replace(/\.md$/, '');
    for (const fmt of COMMON_NOTE_FORMATS) {
      const pattern = buildNoteFormatPattern(fmt);
      if (!pattern) continue;

      // Try matching against the full path — the format might be preceded by a root folder
      const match = pathWithoutExt.match(pattern.unanchoredRegex);
      if (match) {
        const date = extractDateFromMatch(match, pattern);
        if (date) {
          // Extract root: everything before the matched portion
          const matchIndex = pathWithoutExt.indexOf(match[0]);
          if (matchIndex > 0) {
            return pathWithoutExt.substring(0, matchIndex).replace(/\/+$/, '');
          }
          return ""; // File is at vault root
        }
      }
    }

    return null;
  }
}
