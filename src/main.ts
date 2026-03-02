import { Plugin, TFile, Notice, MarkdownView, WorkspaceLeaf, moment } from 'obsidian';
import { DailyOrbitSettings, DEFAULT_SETTINGS, DailyOrbitSettingTab, migrateSettings, createDefaultDailyNotesCalendar } from './settings';
import { CalendarSource, FileOpenType } from './types';
import { hideChildren, showChildren, selectNavbarFromView } from './utils';
import { TimewalkService } from './timewalk-service';
import DailyOrbit from './orbit/orbit';
import DocumentNavigation from './document-navigation/document-navigation';
import { createDailyNote } from 'obsidian-daily-notes-interface';

/**
 * This class is the actual Obsidian plugin.
 */
export default class DailyOrbitPlugin extends Plugin {
	settings: DailyOrbitSettings;
	navbars: Record<string, DailyOrbit> = {};
	nextNavbarId = 0;
	documentNavigations: Record<string, DocumentNavigation> = {};
	nextDocNavId = 0;
	pendingDocNavTimeout: number | null = null;
	timewalkService: TimewalkService;

	async onload() {
		await this.loadSettings();
		this.timewalkService = new TimewalkService(this.app.vault);
		this.ensureDefaultCalendar();
		this.timewalkService.rebuild(this.settings.calendars);
		this.addSettingTab(new DailyOrbitSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf) => {
			this.addDailyOrbit(leaf);
			this.addDocumentNavigation(leaf);
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			// Update orbit and document navigation when file opens in same leaf
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf) {
				// Check if the new file belongs to a different calendar than the current orbit
				const navbarId = selectNavbarFromView(activeLeaf.view);
				const navbar = navbarId ? this.getNavbar(navbarId) : null;
				if (file && navbar) {
					const noteInfo = this.timewalkService.getDailyNoteInfo(file);
					if (!noteInfo || noteInfo.calendarId !== navbar.calendarId) {
						// Cross-calendar or non-daily-note: need full rebuild
						this.addDailyOrbit(activeLeaf);
					} else {
						// Same calendar: lightweight rerender is sufficient
						this.rerenderNavbars();
					}
				} else if (file && !navbar) {
					// No orbit yet: try to add one
					this.addDailyOrbit(activeLeaf);
				} else {
					this.rerenderNavbars();
				}
				this.addDocumentNavigation(activeLeaf);
			}
		}));
		this.registerEvent(this.app.workspace.on("css-change", () => this.rerenderNavbars()));
		this.registerEvent(this.app.vault.on("create", () => {
			this.timewalkService.rebuild(this.settings.calendars);
			this.rerenderNavbars();
		}));
		this.registerEvent(this.app.vault.on("rename", () => {
			this.timewalkService.rebuild(this.settings.calendars);
			this.rerenderNavbars();
		}));
		this.registerEvent(this.app.vault.on("delete", () => {
			this.timewalkService.rebuild(this.settings.calendars);
			this.rerenderNavbars();
		}));
	}

	/**
	 * Ensure a default "daily-notes" calendar exists if the core plugin is enabled
	 */
	private ensureDefaultCalendar() {
		const hasDailyNotesCalendar = this.settings.calendars.some(c => c.sourceType === "daily-notes");
		if (!hasDailyNotesCalendar) {
			const dailyNotesFolder = this.getDailyNotesFolder();
			if (dailyNotesFolder !== null) {
				const noteFormat = this.getDailyNotesFormat();
				const calendar = createDefaultDailyNotesCalendar(dailyNotesFolder, noteFormat);
				this.settings.calendars.push(calendar);
				this.saveSettings();
			}
		} else {
			// Update rootFolder and noteFormat from core plugin for inheriting daily-notes calendars
			const dailyNotesFolder = this.getDailyNotesFolder();
			const noteFormat = this.getDailyNotesFormat();
			for (const cal of this.settings.calendars) {
				if (cal.sourceType === "daily-notes" && cal.inheritFromPlugin) {
					if (dailyNotesFolder !== null) {
						cal.rootFolder = dailyNotesFolder;
					}
					cal.noteFormat = noteFormat;
				}
			}
		}
	}

	/**
	 * Read the root folder from the Daily Notes core plugin
	 */
	getDailyNotesFolder(): string | null {
		// @ts-ignore
		const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
		if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
			// @ts-ignore
			const folder = dailyNotesPlugin.instance?.options?.folder;
			return folder ?? "";
		}
		return null;
	}

	/**
	 * Read the note format from the Daily Notes core plugin
	 */
	getDailyNotesFormat(): string {
		try {
			// @ts-ignore
			const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
			if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
				// @ts-ignore
				const format = dailyNotesPlugin.instance?.options?.format;
				if (format && typeof format === 'string') return format;
			}
		} catch {
			// Ignore errors
		}
		return "YYYY-MM-DD";
	}

	/**
	 * Rebuild the timewalk service and re-render
	 */
	rebuildTimewalkService() {
		this.timewalkService.rebuild(this.settings.calendars);
		this.rerenderNavbars();
	}

	/**
	 * Get a calendar source by ID
	 */
	getCalendar(calendarId: string): CalendarSource | undefined {
		return this.settings.calendars.find(c => c.id === calendarId);
	}

	async addDailyOrbit(leaf: WorkspaceLeaf) {
		// Check for markdown view and file
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		if (!markdownLeaves.includes(leaf)) {
			return;
		}
		const view = leaf.view as MarkdownView;
		const activeFile = view.file;
		if (!activeFile) {
			return;
		}

		// Get view header title container
		const viewHeaderTitleContainers = view.containerEl.getElementsByClassName("view-header-title-container");
		if (viewHeaderTitleContainers.length !== 1) {
			return;
		}
		const titleContainerEl = viewHeaderTitleContainers[0] as HTMLElement;

		// Get navbar if one is attached to the view
		const navbarId = selectNavbarFromView(view);
		const navbar = navbarId ? this.getNavbar(navbarId) : null;

		// Check if file is a daily note using timewalk service
		const noteInfo = this.timewalkService.getDailyNoteInfo(activeFile);
		if (noteInfo) {
			// Found in a configured calendar
			const { date: fileDate, calendarId } = noteInfo;

			// Update metadata when opening a daily note
			await this.updateDailyNoteMetadata(activeFile);

			if (navbar) {
				// Update calendarId if the file moved to a different calendar
				if (navbar.calendarId !== calendarId) {
					this.removeNavbar(navbar.id);
					hideChildren(titleContainerEl);
					this.createNavbar(view, titleContainerEl, fileDate, calendarId);
				} else {
					navbar.rerender();
				}
			} else {
				hideChildren(titleContainerEl);
				this.createNavbar(view, titleContainerEl, fileDate, calendarId);
			}
			return;
		}

		// Check for unconfigured calendar
		const unconfiguredRoot = this.timewalkService.getUnconfiguredCalendarRoot(activeFile);
		if (unconfiguredRoot !== null) {
			// Show unconfigured banner instead of orbit
			if (navbar) {
				this.removeNavbar(navbar.id);
				showChildren(titleContainerEl);
			}
			this.showUnconfiguredBanner(view, titleContainerEl);
			return;
		}

		// Not a daily note at all
		if (navbar) {
			this.removeNavbar(navbar.id);
			showChildren(titleContainerEl);
		}
		// Remove any unconfigured banners too
		this.removeUnconfiguredBanner(view);
	}

	createNavbar(view: MarkdownView, parentEl: HTMLElement, date: moment.Moment, calendarId: string): DailyOrbit {
		// Remove any unconfigured banner
		this.removeUnconfiguredBanner(view);

		const navbarId = `${this.nextNavbarId++}`;
		const navbar = new DailyOrbit(this, navbarId, view, parentEl, date, calendarId);
		this.navbars[navbarId] = navbar;
		return navbar;
	}

	removeNavbar(id: string) {
		const navbar = this.navbars[id];
		if (navbar) {
			navbar.parentEl.removeChild(navbar.containerEl);
			delete this.navbars[id];
		}
	}

	getNavbar(id: string): DailyOrbit | undefined {
		return this.navbars[id];
	}

	rerenderNavbars() {
		for (const navbar of Object.values(this.navbars)) {
			navbar.rerender();
		}
	}

	/**
	 * Show a subtle banner for unconfigured calendar roots
	 */
	private showUnconfiguredBanner(view: MarkdownView, titleContainerEl: HTMLElement) {
		// Remove existing banner first
		this.removeUnconfiguredBanner(view);

		const banner = createDiv({ cls: 'daily-orbit-unconfigured-banner' });
		banner.createSpan({ text: 'Daily Orbit: This note looks like a calendar entry. ' });
		const configureLink = banner.createEl('a', { text: 'Configure', href: '#' });
		configureLink.addEventListener('click', (e) => {
			e.preventDefault();
			// Open settings tab
			// @ts-ignore - openSettingTab exists at runtime
			this.app.setting.open();
			// @ts-ignore
			this.app.setting.openTabById(this.manifest.id);
		});
		banner.createSpan({ text: ' to enable the orbit bar.' });
		titleContainerEl.appendChild(banner);
	}

	/**
	 * Remove unconfigured banner from a view
	 */
	private removeUnconfiguredBanner(view: MarkdownView) {
		const banners = view.containerEl.getElementsByClassName('daily-orbit-unconfigured-banner');
		while (banners.length > 0) {
			banners[0].remove();
		}
	}

	/**
	 * Update frontmatter metadata for a daily note file
	 * Adds/updates properties based on configured templates
	 */
	async updateDailyNoteMetadata(file: TFile): Promise<void> {
		// Early exit if feature is disabled
		if (!this.settings.enableAutoMetadata) {
			return;
		}

		// Check if file is a daily note
		const noteInfo = this.timewalkService.getDailyNoteInfo(file);
		if (!noteInfo) {
			return; // Not a daily note, skip
		}
		const fileDate = noteInfo.date;
		const calendar = this.getCalendar(noteInfo.calendarId);
		if (!calendar) return;

		try {
			// Parse metadata properties from settings
			const properties = this.parseMetadataProperties(this.settings.metadataProperties);
			if (properties.length === 0) {
				return; // No properties configured
			}

			const namespace = this.settings.metadataNamespace;

			// Update frontmatter atomically
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				for (const { key, template } of properties) {
					const value = this.replaceTemplateTokens(template, fileDate, calendar);
					frontmatter[`${namespace}${key}`] = value;
				}
			});

			console.log(`[Daily Orbit] Updated metadata for ${file.path}`);
		} catch (error) {
			console.error(`[Daily Orbit] Failed to update metadata for ${file.path}:`, error);
			// Don't show Notice - this is a background operation
		}
	}

	/**
	 * Parse metadata properties configuration string
	 * Format: "key: template" per line, ignoring empty lines and comments
	 */
	private parseMetadataProperties(config: string): Array<{ key: string, template: string }> {
		const properties: Array<{ key: string, template: string }> = [];
		const lines = config.split('\n');

		for (const line of lines) {
			const trimmed = line.trim();
			// Skip empty lines and comments
			if (trimmed === '' || trimmed.startsWith('#')) {
				continue;
			}

			// Parse "key: template" format
			const colonIndex = trimmed.indexOf(':');
			if (colonIndex === -1) {
				continue; // Invalid format, skip
			}

			const key = trimmed.substring(0, colonIndex).trim();
			const template = trimmed.substring(colonIndex + 1).trim();

			if (key && template) {
				properties.push({ key, template });
			}
		}

		return properties;
	}

	/**
	 * Replace template tokens with actual date values
	 * Supports: {YYYY}, {YY}, {MM}, {M}, {MMM}, {MMMM}, {DD}, {D}, {ddd}, {dddd}, {WW}, {W}, {WYYYY}
	 */
	private replaceTemplateTokens(template: string, date: moment.Moment, calendar: CalendarSource): string | number {
		let result = template;

		// Get week number and year for week-related tokens
		const { weekNumber, weekYear } = this.getWeekNumberAndYear(date, calendar);

		// Replace week-specific tokens first
		result = result.replace(/\{WYYYY\}/g, weekYear.toString());
		result = result.replace(/\{WW\}/g, weekNumber.toString().padStart(2, '0'));
		result = result.replace(/\{W\}/g, weekNumber.toString());

		// Replace all other moment.js format tokens
		// Match {TOKEN} pattern and replace with moment format
		result = result.replace(/\{([^}]+)\}/g, (match, token) => {
			return date.format(token);
		});

		// If the result is a pure number string, return as number
		if (/^\d+$/.test(result)) {
			return parseInt(result, 10);
		}

		return result;
	}

	/**
	 * Calculate week number and year (handles cross-year boundaries correctly)
	 * Respects per-calendar firstDayOfWeek setting
	 */
	private getWeekNumberAndYear(date: moment.Moment, calendar: CalendarSource): { weekNumber: number, weekYear: number } {
		if (calendar.firstDayOfWeek === "Monday") {
			// ISO week: use isoWeek() and isoWeekYear() to handle year boundaries correctly
			return {
				weekNumber: date.isoWeek(),
				weekYear: date.isoWeekYear()
			};
		} else {
			// Sunday-based: calculate weeks from first Sunday of year
			const startOfYear = date.clone().startOf('year');
			const firstSunday = startOfYear.clone().day(0);
			if (firstSunday.isAfter(startOfYear)) {
				firstSunday.subtract(7, 'days');
			}
			const daysSinceFirstSunday = date.diff(firstSunday, 'days');
			const weekNumber = Math.floor(daysSinceFirstSunday / 7) + 1;

			// For Sunday-based, the year is always the calendar year
			return {
				weekNumber: weekNumber,
				weekYear: date.year()
			};
		}
	}

	async addDocumentNavigation(leaf: WorkspaceLeaf) {
		// Check for markdown view
		const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
		if (!markdownLeaves.includes(leaf)) {
			return;
		}
		const view = leaf.view as MarkdownView;
		const activeFile = view.file;
		if (!activeFile) {
			return;
		}

		// Check if file is a daily note
		const noteInfo = this.timewalkService.getDailyNoteInfo(activeFile);
		if (!noteInfo) {
			// Not a daily note - remove navigation if exists
			this.removeAllDocumentNavigations();
			return;
		}

		// Cancel any pending navigation creation to prevent duplicates
		if (this.pendingDocNavTimeout !== null) {
			clearTimeout(this.pendingDocNavTimeout);
			this.pendingDocNavTimeout = null;
		}

		// Remove existing navigations first to prevent duplicates
		this.removeAllDocumentNavigations();

		// Wait for content to render (H1 may not be in DOM immediately)
		this.pendingDocNavTimeout = window.setTimeout(() => {
			this.pendingDocNavTimeout = null;
			const docNavId = `${this.nextDocNavId++}`;
			const docNav = new DocumentNavigation(this, view, noteInfo.date, noteInfo.calendarId);
			this.documentNavigations[docNavId] = docNav;

			// Cleanup on view unload
			view.register(() => {
				this.removeDocumentNavigation(docNavId);
			});
		}, 150); // Small delay for markdown to render
	}

	removeDocumentNavigation(id: string) {
		const docNav = this.documentNavigations[id];
		if (docNav) {
			docNav.destroy();
			delete this.documentNavigations[id];
		}
	}

	removeAllDocumentNavigations() {
		for (const id in this.documentNavigations) {
			this.removeDocumentNavigation(id);
		}
	}

	/**
	 * Create a note for a custom calendar using its noteFormat
	 */
	async createNoteForCalendar(date: moment.Moment, calendar: CalendarSource): Promise<TFile> {
		const formatted = date.format(calendar.noteFormat);
		const root = calendar.rootFolder ? calendar.rootFolder.replace(/\/+$/, '') + '/' : '';
		const filePath = `${root}${formatted}.md`;

		// Ensure parent directories exist
		const parentDir = filePath.substring(0, filePath.lastIndexOf('/'));
		if (parentDir) {
			const existing = this.app.vault.getAbstractFileByPath(parentDir);
			if (!existing) {
				await this.app.vault.createFolder(parentDir);
			}
		}

		// Create the file
		return await this.app.vault.create(filePath, '');
	}

	/**
	 * Find or create a daily note for the given date and calendar
	 */
	async ensureDailyNote(date: moment.Moment, calendarId: string): Promise<TFile> {
		// Try to find existing note first
		const existing = this.timewalkService.findDailyNote(date, calendarId);
		if (existing) return existing;

		const calendar = this.getCalendar(calendarId);
		if (!calendar) {
			throw new Error(`Calendar not found: ${calendarId}`);
		}

		// For inherited daily-notes calendars, use the core plugin's createDailyNote
		if (calendar.sourceType === 'daily-notes' && calendar.inheritFromPlugin) {
			return await createDailyNote(date);
		}

		// For custom calendars or non-inheriting daily-notes, create using noteFormat
		return await this.createNoteForCalendar(date, calendar);
	}

	async openDailyNote(date: moment.Moment, openType: FileOpenType, calendarId?: string) {
		// Determine which calendar to use
		const effectiveCalendarId = calendarId || this.getActiveCalendarId();
		if (!effectiveCalendarId) {
			new Notice("Daily Orbit: No calendar configured");
			return;
		}

		// Find or create the note
		let dailyNote: TFile;
		try {
			dailyNote = await this.ensureDailyNote(date, effectiveCalendarId);
		} catch (error) {
			console.error('[Daily Orbit] Failed to ensure daily note:', error);
			new Notice(`Daily Orbit: Failed to create note`);
			return;
		}

		this.openFile(dailyNote, openType);
	}

	/**
	 * Get the calendarId of the currently active orbit (if any)
	 */
	private getActiveCalendarId(): string | null {
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf) {
			const navbarId = selectNavbarFromView(activeLeaf.view);
			if (navbarId) {
				const navbar = this.getNavbar(navbarId);
				if (navbar) return navbar.calendarId;
			}
		}
		// Fallback: use the first enabled calendar
		const firstEnabled = this.settings.calendars.find(c => c.enabled);
		return firstEnabled?.id ?? null;
	}

	async openFile(file: TFile, openType: FileOpenType) {
		switch (openType) {
			case "New window":
				await this.app.workspace
					.getLeaf("window")
					.openFile(file, { active: this.settings.setActive });
				return;
			case "New tab":
				await this.app.workspace
					.getLeaf("tab")
					.openFile(file, { active: this.settings.setActive });
				return;
			case "Split right":
				await this.app.workspace
					.getLeaf("split", "vertical")
					.openFile(file, { active: this.settings.setActive });
				return;
			case "Split down":
				await this.app.workspace
					.getLeaf("split", "horizontal")
					.openFile(file, { active: this.settings.setActive });
				return;
			case "Active":
				await this.app.workspace
					.getLeaf()
					.openFile(file, { active: true });
				break;
		}
	}

	async loadSettings() {
		const data = await this.loadData();
		if (data) {
			const dailyNotesFolder = this.getDailyNotesFolderFromData();
			const dailyNotesFormat = this.getDailyNotesFormat();
			this.settings = migrateSettings(data, dailyNotesFolder, dailyNotesFormat);
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}
	}

	/**
	 * Try to read the Daily Notes folder early (before full plugin init).
	 * Fallback to "" if not available.
	 */
	private getDailyNotesFolderFromData(): string {
		try {
			// @ts-ignore
			const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
			if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
				// @ts-ignore
				return dailyNotesPlugin.instance?.options?.folder ?? "";
			}
		} catch {
			// Ignore errors during early init
		}
		return "";
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
