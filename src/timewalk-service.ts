import { TFile, moment, Vault } from 'obsidian';
import { Timewalk, Waypoint, GroupWaypoint } from './timewalk';
import { CalendarSource } from './types';

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

/** Daily note path regex: YYYY/MM. MMM/DD ddd.md */
const DAILY_NOTE_PATTERN = /(\d{4})\/(\d{2})\.\s*\w+\/(\d{2})\s+\w+\.md$/;
const DAILY_NOTE_PATH_CAPTURE = /(\d{4})\/(\d{2})\.\s*\w+\/(\d{2})\s+\w+/;

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

    const enabledCalendars = calendars.filter(c => c.enabled);
    const allFiles = this.vault.getMarkdownFiles();
    const matchingFiles = allFiles.filter(file => DAILY_NOTE_PATTERN.test(file.path));

    for (const calendar of enabledCalendars) {
      const root = new GroupWaypoint(calendar.id);
      const waypointMap = new Map<string, ObsidianFileWaypoint>();

      // Filter files under this calendar's root folder
      const calendarFiles = matchingFiles.filter(file =>
        this.fileIsUnderRoot(file.path, calendar.rootFolder)
      );

      for (const file of calendarFiles) {
        const pathMatch = file.path.match(DAILY_NOTE_PATH_CAPTURE);
        if (pathMatch) {
          const [, year, month, day] = pathMatch;
          const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
          const waypoint = new ObsidianFileWaypoint(file, date);
          root.addChild(waypoint);
          waypointMap.set(file.path, waypoint);
        }
      }

      this.calendarTimewalks.set(calendar.id, new Timewalk(root));
      this.calendarWaypointMaps.set(calendar.id, waypointMap);
    }
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

    // Fallback: try to parse from path and match to a calendar
    const pathMatch = file.path.match(DAILY_NOTE_PATH_CAPTURE);
    if (pathMatch) {
      const [, year, month, day] = pathMatch;
      const dateStr = `${year}-${month}-${day}`;
      const parsedDate = moment(dateStr, "YYYY-MM-DD");
      if (!parsedDate.isValid()) return null;

      // Find which enabled calendar this file belongs to
      for (const calendar of this.calendars.filter(c => c.enabled)) {
        if (this.fileIsUnderRoot(file.path, calendar.rootFolder)) {
          return { date: parsedDate, calendarId: calendar.id };
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
   * If a file matches the daily note regex but doesn't fall under any configured calendar's rootFolder,
   * extract the path prefix before the YYYY/ part and return it.
   */
  getUnconfiguredCalendarRoot(file: TFile): string | null {
    // Must match the daily note pattern
    if (!DAILY_NOTE_PATTERN.test(file.path)) return null;

    // Check if it falls under any configured calendar
    for (const calendar of this.calendars.filter(c => c.enabled)) {
      if (this.fileIsUnderRoot(file.path, calendar.rootFolder)) {
        return null; // Already configured
      }
    }

    // Extract root: everything before the YYYY/ part
    const yearMatch = file.path.match(/^(.+?)\/\d{4}\//);
    if (yearMatch) {
      return yearMatch[1];
    }

    return ""; // File is at vault root
  }
}
