import { Plugin, TFile, Notice, MarkdownView, WorkspaceLeaf, moment } from 'obsidian';
import { DailyOrbitSettings, DEFAULT_SETTINGS, DailyOrbitSettingTab } from './settings';
import { FileOpenType } from './types';
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
		this.addSettingTab(new DailyOrbitSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf) => {
			this.addDailyOrbit(leaf);
			this.addDocumentNavigation(leaf);
		}));
		this.registerEvent(this.app.workspace.on("file-open", (file) => {
			// Re-add document navigation when file opens in same leaf
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf) {
				this.addDocumentNavigation(activeLeaf);
			}
		}));
		this.registerEvent(this.app.workspace.on("css-change", () => this.rerenderNavbars()));
		this.registerEvent(this.app.vault.on("create", () => {
			this.timewalkService.rebuild();
			this.rerenderNavbars();
		}));
		this.registerEvent(this.app.vault.on("rename", () => {
			this.timewalkService.rebuild();
			this.rerenderNavbars();
		}));
		this.registerEvent(this.app.vault.on("delete", () => {
			this.timewalkService.rebuild();
			this.rerenderNavbars();
		}));
	}

	async addDailyOrbit(leaf: WorkspaceLeaf) {
		if (!this.hasDependencies()) {
			return;
		}

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
		const fileDate = this.timewalkService.getDailyNoteDate(activeFile);

		if (!fileDate) {
			// Not a daily note
			if (navbar) {
				this.removeNavbar(navbar.id);
				showChildren(titleContainerEl);
			}
			return;
		}

		// Update metadata when opening a daily note
		await this.updateDailyNoteMetadata(activeFile);

		if (navbar) {
			// Reuse navbar for new file
			navbar.rerender();
		} else {
			hideChildren(titleContainerEl);
			this.createNavbar(view, titleContainerEl, fileDate);
		}
	}

	createNavbar(view: MarkdownView, parentEl: HTMLElement, date: moment.Moment): DailyOrbit {
		const navbarId = `${this.nextNavbarId++}`;
		const navbar = new DailyOrbit(this, navbarId, view, parentEl, date);
		this.navbars[navbarId] = navbar;
		return navbar;
	}

	removeNavbar(id: string) {
		const navbar = this.navbars[id];
		navbar.parentEl.removeChild(navbar.containerEl);
		delete this.navbars[id];
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
	 * Update frontmatter metadata for a daily note file
	 * Adds/updates properties based on configured templates
	 */
	async updateDailyNoteMetadata(file: TFile): Promise<void> {
		// Early exit if feature is disabled
		if (!this.settings.enableAutoMetadata) {
			return;
		}

		// Check if file is a daily note
		const fileDate = this.timewalkService.getDailyNoteDate(file);
		if (!fileDate) {
			return; // Not a daily note, skip
		}

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
					const value = this.replaceTemplateTokens(template, fileDate);
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
	private replaceTemplateTokens(template: string, date: moment.Moment): string | number {
		let result = template;

		// Get week number and year for week-related tokens
		const { weekNumber, weekYear } = this.getWeekNumberAndYear(date);

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
	 * Respects firstDayOfWeek setting
	 */
	private getWeekNumberAndYear(date: moment.Moment): { weekNumber: number, weekYear: number } {
		if (this.settings.firstDayOfWeek === "Monday") {
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
		const fileDate = this.timewalkService.getDailyNoteDate(activeFile);
		if (!fileDate) {
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
			const docNav = new DocumentNavigation(this, view, fileDate);
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

	async openDailyNote(date: moment.Moment, openType: FileOpenType) {
		// Use timewalk service to find the correct file
		let dailyNote = this.timewalkService.findDailyNote(date);

		// If not found, create it directly (bypasses buggy getDailyNote lookup)
		if (!dailyNote) {
			console.log('[Daily Orbit] Creating new daily note for', date.format('YYYY-MM-DD'));
			dailyNote = await createDailyNote(date);
		}

		this.openFile(dailyNote, openType);
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

	hasDependencies() {
		// @ts-ignore
		const dailyNotesPlugin = this.app.internalPlugins.plugins["daily-notes"];
		// @ts-ignore
		const periodicNotes = this.app.plugins.getPlugin("periodic-notes");

		if (!dailyNotesPlugin && !periodicNotes) {
			new Notice("Daily Orbit: Install Periodic Notes or Daily Notes");
			return false;
		}

		if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
			return true;
		} else if (periodicNotes && periodicNotes.settings?.daily?.enabled) {
			return true;
		}

		new Notice("Daily Orbit: Enable Periodic Notes or Daily Notes");
		return false;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

