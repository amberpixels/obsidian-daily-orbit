import { Plugin, TFile, Notice, MarkdownView, WorkspaceLeaf, moment } from 'obsidian';
import { DailyNoteNavbarSettings, DEFAULT_SETTINGS, DailyNoteNavbarSettingTab } from './settings';
import { FileOpenType } from './types';
import { hideChildren, showChildren, selectNavbarFromView } from './utils';
import { TimewalkService } from './timewalkService';
import DailyNoteNavbar from './dailyNoteNavbar/dailyNoteNavbar';
import DocumentNavigation from './documentNavigation/documentNavigation';
import { createDailyNote } from 'obsidian-daily-notes-interface';

/**
 * This class is the actual Obsidian plugin.
 */
export default class DailyNoteNavbarPlugin extends Plugin {
	settings: DailyNoteNavbarSettings;
	navbars: Record<string, DailyNoteNavbar> = {};
	nextNavbarId = 0;
	documentNavigations: Record<string, DocumentNavigation> = {};
	nextDocNavId = 0;
	pendingDocNavTimeout: number | null = null;
	timewalkService: TimewalkService;

	async onload() {
		await this.loadSettings();
		this.timewalkService = new TimewalkService(this.app.vault);
		this.addSettingTab(new DailyNoteNavbarSettingTab(this.app, this));
		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf: WorkspaceLeaf) => {
			this.addDailyNoteNavbar(leaf);
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

	async addDailyNoteNavbar(leaf: WorkspaceLeaf) {
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
		
		if (navbar) {
			// Reuse navbar for new file
			navbar.rerender();
		} else {
			hideChildren(titleContainerEl);
			this.createNavbar(view, titleContainerEl, fileDate);
		}
	}

	createNavbar(view: MarkdownView, parentEl: HTMLElement, date: moment.Moment): DailyNoteNavbar {
		const navbarId = `${this.nextNavbarId++}`;
		const navbar = new DailyNoteNavbar(this, navbarId, view, parentEl, date);
		this.navbars[navbarId] = navbar;
		return navbar;
	}

	removeNavbar(id: string) {
		const navbar = this.navbars[id];
		navbar.parentEl.removeChild(navbar.containerEl);
		delete this.navbars[id];
	}

	getNavbar(id: string): DailyNoteNavbar | undefined {
		return this.navbars[id];
	}

	rerenderNavbars() {
		for (const navbar of Object.values(this.navbars)) {
			navbar.rerender();
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
			console.log('[Daily Note Navbar] Creating new daily note for', date.format('YYYY-MM-DD'));
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
			new Notice("Daily Note Navbar: Install Periodic Notes or Daily Notes");
			return false;
		}

		if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
			return true;
		} else if (periodicNotes && periodicNotes.settings?.daily?.enabled) {
			return true;
		}

		new Notice("Daily Note Navbar: Enable Periodic Notes or Daily Notes");
		return false;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

