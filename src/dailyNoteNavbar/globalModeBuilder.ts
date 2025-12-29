import { moment, TFile } from 'obsidian';
import { TimewalkService } from '../timewalkService';
import { ObsidianFileWaypoint } from '../timewalkService';

/**
 * Item types in global mode timeline
 */
export type GlobalNavItem = {
	type: 'note' | 'gap';
	date: moment.Moment;
	file?: TFile;           // Only for notes
	gapCount?: number;      // Only for gaps: number of missing days
	isActive?: boolean;     // Is this the currently open note?
	isCurrent?: boolean;    // Is this today?
};

/**
 * Builds a timeline of all daily notes with collapsed gaps for missing dates
 *
 * Algorithm:
 * 1. Get all daily notes chronologically (oldest first)
 * 2. For each note, create a 'note' item
 * 3. Calculate gap to next note (date diff - 1)
 * 4. If gap > 0, insert a 'gap' item with the count
 * 5. Result: Interleaved array of notes and gaps
 *
 * @param timewalkService - Service for accessing daily notes
 * @param activeDate - Currently active daily note date
 * @param currentDate - Today's date
 * @returns Array of timeline items
 */
export function buildGlobalTimeline(
	timewalkService: TimewalkService,
	activeDate: moment.Moment,
	currentDate: moment.Moment
): GlobalNavItem[] {
	const items: GlobalNavItem[] = [];

	// Get all daily note waypoints chronologically (oldest first)
	const waypoints: ObsidianFileWaypoint[] = [];
	timewalkService.getTimewalk().traverse((waypoint) => {
		waypoints.push(waypoint as ObsidianFileWaypoint);
	}, { direction: 'future', filter: 'leaves' });

	if (waypoints.length === 0) {
		return items;
	}

	// Process waypoints and detect gaps
	for (let i = 0; i < waypoints.length; i++) {
		const waypoint = waypoints[i];
		const waypointDate = moment.utc(waypoint.time());
		const file = waypoint.getFile();

		// Add note item
		items.push({
			type: 'note',
			date: waypointDate,
			file: file,
			isActive: waypointDate.format('YYYY-MM-DD') === activeDate.format('YYYY-MM-DD'),
			isCurrent: waypointDate.format('YYYY-MM-DD') === currentDate.format('YYYY-MM-DD'),
		});

		// Check for gap to next waypoint
		if (i < waypoints.length - 1) {
			const nextWaypoint = waypoints[i + 1];
			const nextDate = moment.utc(nextWaypoint.time());
			const daysBetween = nextDate.diff(waypointDate, 'days') - 1;

			if (daysBetween > 0) {
				// Add gap item (date is the start of the gap)
				items.push({
					type: 'gap',
					date: waypointDate.clone().add(1, 'day'),
					gapCount: daysBetween,
				});
			}
		}
	}

	return items;
}
