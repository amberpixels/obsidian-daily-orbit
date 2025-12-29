/**
 * Core interface that all navigable nodes must implement
 */
export interface Waypoint {
  /** Returns unique identifier for this waypoint */
  identifier(): string;

  /** Returns the time associated with this waypoint */
  time(): Date;

  /** Returns true if this waypoint can have children */
  isContainer(): boolean;

  /** Returns child waypoints */
  children(): Waypoint[];
}

/**
 * Direction for traversal
 */
export type Direction = 'past' | 'future';

/**
 * Filter type for node selection
 */
export type Filter = 'all' | 'leaves' | 'containers';

/**
 * Options for traversal configuration
 */
export interface TraverseOptions {
  /** Direction of traversal: 'past' (newest first) or 'future' (oldest first) */
  direction?: Direction;

  /** Filter nodes by type */
  filter?: Filter;

  /** Include nodes with invalid/zero time values */
  includeNonCalendar?: boolean;
}

/**
 * Timewalk - A time-based navigation and traversal wrapper for hierarchical data structures
 */
export class Timewalk {
  private root: Waypoint;

  constructor(root: Waypoint) {
    this.root = root;
  }

  /**
   * Recursively traverses all children of the root waypoint and calls the callback
   * for each waypoint that matches the filter criteria
   */
  traverse(callback: (waypoint: Waypoint) => void, options: TraverseOptions = {}): void {
    const {
      direction = 'past',
      filter = 'all',
      includeNonCalendar = false
    } = options;

    // Collect all children recursively
    const allNodes = this.collectAllChildren(this.root);

    // Filter nodes based on options
    let filtered = allNodes.filter(node => {
      // Filter by node type
      if (filter === 'leaves' && node.isContainer()) return false;
      if (filter === 'containers' && !node.isContainer()) return false;

      // Filter by calendar validity (only apply to leaf nodes)
      if (!includeNonCalendar && !node.isContainer()) {
        const time = node.time();
        if (!time || time.getTime() === 0 || isNaN(time.getTime())) {
          return false;
        }
      }

      return true;
    });

    // Sort by time
    filtered.sort((a, b) => {
      const timeA = a.time().getTime();
      const timeB = b.time().getTime();
      return direction === 'past' ? timeB - timeA : timeA - timeB;
    });

    // Execute callback for each node
    filtered.forEach(callback);
  }

  /**
   * Returns the first waypoint matching the given time
   */
  navigate(targetTime: Date | string): Waypoint | null {
    const target = typeof targetTime === 'string' ? new Date(targetTime) : targetTime;
    const targetTimestamp = target.getTime();

    const allNodes = this.collectAllChildren(this.root);

    // Find exact match (skip containers)
    for (const node of allNodes) {
      if (node.isContainer()) continue;
      const nodeTime = node.time().getTime();
      if (nodeTime === targetTimestamp) {
        return node;
      }
    }

    return null;
  }

  /**
   * Returns all waypoints matching the given time or time range
   */
  find(targetTime: Date | string): Waypoint[] {
    const target = typeof targetTime === 'string' ? new Date(targetTime) : targetTime;

    const allNodes = this.collectAllChildren(this.root);

    // Find all nodes with matching date (same day, skip containers)
    return allNodes.filter(node => {
      if (node.isContainer()) return false;
      const nodeTime = node.time();
      return this.isSameDay(nodeTime, target);
    });
  }

  /**
   * Collects all children recursively from a waypoint
   */
  private collectAllChildren(waypoint: Waypoint): Waypoint[] {
    const result: Waypoint[] = [waypoint];

    if (waypoint.isContainer()) {
      const children = waypoint.children();
      for (const child of children) {
        result.push(...this.collectAllChildren(child));
      }
    }

    return result;
  }

  /**
   * Checks if two dates are on the same day
   */
  isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }
}

/**
 * Simple string-based waypoint implementation
 */
export class StringWaypoint implements Waypoint {
  constructor(private id: string, private date: Date) {}

  identifier(): string {
    return this.id;
  }

  time(): Date {
    return this.date;
  }

  isContainer(): boolean {
    return false;
  }

  children(): Waypoint[] {
    return [];
  }
}

/**
 * Group waypoint for containing multiple waypoints
 */
export class GroupWaypoint implements Waypoint {
  constructor(
    private id: string,
    private childNodes: Waypoint[] = [],
    private groupTime?: Date
  ) {}

  identifier(): string {
    return this.id;
  }

  time(): Date {
    if (this.groupTime) {
      return this.groupTime;
    }
    // Return the earliest time from children
    if (this.childNodes.length > 0) {
      const times = this.childNodes.map(c => c.time().getTime()).filter(t => !isNaN(t));
      return times.length > 0 ? new Date(Math.min(...times)) : new Date(0);
    }
    return new Date(0);
  }

  isContainer(): boolean {
    return true;
  }

  children(): Waypoint[] {
    return this.childNodes;
  }

  addChild(waypoint: Waypoint): void {
    this.childNodes.push(waypoint);
  }
}
