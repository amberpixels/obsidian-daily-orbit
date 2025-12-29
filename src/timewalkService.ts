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
      console.log('[TimewalkService] ✅ File is a daily note:', file.path, '→', date.toISOString());
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
        console.log('[TimewalkService] ⚠️  File not in map, but parsed from path:', file.path, '→', dateStr);
        return parsedDate;
      }
    }

    console.log('[TimewalkService] ❌ Not a daily note:', file.path);
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
      console.log('[TimewalkService] Found daily note for', date.format('YYYY-MM-DD'), '→', waypoint.getFile().path);
      return waypoint.getFile();
    }

    console.log('[TimewalkService] No daily note found for', date.format('YYYY-MM-DD'));
    return null;
  }

  /**
   * Check if a daily note exists for a date
   */
  hasDailyNote(date: moment.Moment): boolean {
    return this.findDailyNote(date) !== null;
  }

  /**
   * Get the underlying timewalk instance
   */
  getTimewalk(): Timewalk {
    return this.timewalk;
  }
}
