import { TFile, moment, Vault } from 'obsidian';
import { Timewalk, Waypoint, GroupWaypoint } from './timewalk';

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
 * Service for managing timewalk instance with Obsidian daily notes
 */
export class TimewalkService {
  private timewalk: Timewalk;
  private waypointMap: Map<string, ObsidianFileWaypoint> = new Map();
  private vault: Vault;

  constructor(vault: Vault) {
    this.vault = vault;
    // Initialize with empty timewalk first
    this.timewalk = new Timewalk(new GroupWaypoint('daily-notes'));
    this.rebuild();
  }

  /**
   * Rebuild the timewalk instance from current daily notes
   */
  rebuild(): void {
    const root = new GroupWaypoint('daily-notes');
    this.waypointMap.clear();

    console.log('[TimewalkService] Building timewalk from vault files...');

    // Scan vault for files matching daily note pattern
    const allFiles = this.vault.getMarkdownFiles();
    const dailyNotePattern = /(\d{4})\/(\d{2})\.\s*\w+\/(\d{2})\s+\w+\.md$/;
    const matchingFiles = allFiles.filter(file => dailyNotePattern.test(file.path));

    console.log('[TimewalkService] Found', matchingFiles.length, 'files matching daily note pattern');

    // Convert files to waypoints by parsing dates from FILE PATHS
    let addedCount = 0;
    for (const file of matchingFiles) {
      // Parse date from path pattern: YYYY/MM. MMM/DD ddd
      // Example: 0C. Calendarish/2025/12. Dec/29 Mon.md
      const pathMatch = file.path.match(/(\d{4})\/(\d{2})\.\s*\w+\/(\d{2})\s+\w+/);
      if (pathMatch) {
        const [, year, month, day] = pathMatch;
        // Use Date.UTC to avoid timezone issues - all dates at midnight UTC
        const date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));

        const waypoint = new ObsidianFileWaypoint(file, date);
        root.addChild(waypoint);
        this.waypointMap.set(file.path, waypoint);
        addedCount++;
      }
    }

    console.log('[TimewalkService] Added', addedCount, 'daily note waypoints');

    this.timewalk = new Timewalk(root);
  }

  /**
   * Check if a file is a daily note and return its date
   */
  getDailyNoteDate(file: TFile): moment.Moment | null {
    const waypoint = this.waypointMap.get(file.path);
    if (waypoint) {
      const date = waypoint.time();
      return moment(date);
    }

    // Fallback: try to parse from path
    // Pattern: YYYY/MM. MMM/DD ddd
    const pathMatch = file.path.match(/(\d{4})\/(\d{2})\.\s*\w+\/(\d{2})\s+\w+/);
    if (pathMatch) {
      const [, year, month, day] = pathMatch;
      const dateStr = `${year}-${month}-${day}`;
      const parsedDate = moment(dateStr, "YYYY-MM-DD");

      if (parsedDate.isValid()) {
        return parsedDate;
      }
    }

    return null;
  }

  /**
   * Find the daily note file for a specific date
   */
  findDailyNote(date: moment.Moment): TFile | null {
    const targetDate = date.toDate();
    const results = this.timewalk.find(targetDate);

    if (results.length > 0) {
      const waypoint = results[0] as ObsidianFileWaypoint;
      return waypoint.getFile();
    }

    return null;
  }

  /**
   * Check if a daily note exists for a date
   */
  hasDailyNote(date: moment.Moment): boolean {
    return this.findDailyNote(date) !== null;
  }

  /**
   * Get the previous daily note before the given date
   */
  getPreviousDailyNote(currentDate: moment.Moment): TFile | null {
    const { waypoints, currentIndex } = this.getSortedWaypoints(currentDate);

    if (currentIndex > 0) {
      return (waypoints[currentIndex - 1] as ObsidianFileWaypoint).getFile();
    }
    return null;
  }

  /**
   * Get the next daily note after the given date
   */
  getNextDailyNote(currentDate: moment.Moment): TFile | null {
    const { waypoints, currentIndex } = this.getSortedWaypoints(currentDate);

    if (currentIndex !== -1 && currentIndex < waypoints.length - 1) {
      return (waypoints[currentIndex + 1] as ObsidianFileWaypoint).getFile();
    }
    return null;
  }

  /**
   * Get sorted waypoints and find current note's index
   */
  private getSortedWaypoints(currentDate: moment.Moment): { waypoints: Waypoint[], currentIndex: number } {
    const waypoints: Waypoint[] = [];

    // Traverse in 'future' direction (oldest first) to get chronological order
    this.timewalk.traverse((waypoint) => {
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
   * Get the underlying timewalk instance
   */
  getTimewalk(): Timewalk {
    return this.timewalk;
  }
}
