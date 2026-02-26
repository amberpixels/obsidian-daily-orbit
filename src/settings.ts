import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from "obsidian";
import { FirstDayOfWeek, FIRST_DAY_OF_WEEK, FileOpenType, FILE_OPEN_TYPES, NavbarMode, NAVBAR_MODES, CalendarSource } from "./types";
import { toRecord } from "./utils";
import DailyOrbitPlugin from "./main";

/**
 * Folder autocomplete suggest for text inputs.
 * Shows matching vault folders as the user types.
 */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	getSuggestions(inputStr: string): TFolder[] {
		const folders: TFolder[] = [];
		for (const file of this.app.vault.getAllLoadedFiles()) {
			if (file instanceof TFolder) {
				folders.push(file);
			}
		}

		if (!inputStr) return folders;

		const lower = inputStr.toLowerCase();
		return folders.filter(f => f.path.toLowerCase().contains(lower));
	}

	renderSuggestion(folder: TFolder, el: HTMLElement) {
		el.setText(folder.path || "(vault root)");
	}

	selectSuggestion(folder: TFolder) {
		this.setValue(folder.path);
		this.close();
	}
}

export interface DailyOrbitSettings {
	calendars: CalendarSource[];
	defaultOpenType: FileOpenType;
	setActive: boolean;
	enableAutoMetadata: boolean;
	metadataNamespace: string;
	metadataProperties: string; // Multi-line text: "key: template" per line
}

/** Default per-calendar settings used when creating new calendars */
export const DEFAULT_CALENDAR_SETTINGS = {
	dateFormat: "ddd",
	tooltipDateFormat: "YYYY-MM-DD",
	firstDayOfWeek: "Monday" as FirstDayOfWeek,
	navbarMode: "weekly" as NavbarMode,
};

/**
 * The plugins default settings.
 */
export const DEFAULT_SETTINGS: DailyOrbitSettings = {
	calendars: [],
	defaultOpenType: "Active",
	setActive: true,
	enableAutoMetadata: false,
	metadataNamespace: "dn-",
	metadataProperties: `date: {YYYY-MM-DD}
week: {WYYYY}-W{WW}
month: {MM}
year: {YYYY}`
}

/**
 * Generate a simple UUID for calendar IDs
 */
export function generateCalendarId(): string {
	return 'cal-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
 * Create a default "daily-notes" calendar source
 */
export function createDefaultDailyNotesCalendar(rootFolder: string): CalendarSource {
	return {
		id: generateCalendarId(),
		sourceType: "daily-notes",
		name: "Daily Notes",
		enabled: true,
		rootFolder,
		...DEFAULT_CALENDAR_SETTINGS,
	};
}

/**
 * Migrate old flat settings to new calendar-based settings.
 * If loaded data has old per-calendar fields at the top level but no calendars array,
 * create a default calendar from those settings.
 */
export function migrateSettings(data: Record<string, unknown>, dailyNotesFolder: string): DailyOrbitSettings {
	// Already migrated
	if (data.calendars && Array.isArray(data.calendars)) {
		return Object.assign({}, DEFAULT_SETTINGS, {
			calendars: data.calendars,
			defaultOpenType: data.defaultOpenType ?? DEFAULT_SETTINGS.defaultOpenType,
			setActive: data.setActive ?? DEFAULT_SETTINGS.setActive,
			enableAutoMetadata: data.enableAutoMetadata ?? DEFAULT_SETTINGS.enableAutoMetadata,
			metadataNamespace: data.metadataNamespace ?? DEFAULT_SETTINGS.metadataNamespace,
			metadataProperties: data.metadataProperties ?? DEFAULT_SETTINGS.metadataProperties,
		}) as DailyOrbitSettings;
	}

	// Old format: migrate per-calendar fields into a default calendar
	const calendar = createDefaultDailyNotesCalendar(dailyNotesFolder);
	if (data.dateFormat && typeof data.dateFormat === 'string') {
		calendar.dateFormat = data.dateFormat;
	}
	if (data.tooltipDateFormat && typeof data.tooltipDateFormat === 'string') {
		calendar.tooltipDateFormat = data.tooltipDateFormat;
	}
	if (data.firstDayOfWeek && typeof data.firstDayOfWeek === 'string') {
		calendar.firstDayOfWeek = data.firstDayOfWeek as FirstDayOfWeek;
	}
	if (data.navbarMode && typeof data.navbarMode === 'string') {
		calendar.navbarMode = data.navbarMode as NavbarMode;
	}

	return {
		calendars: [calendar],
		defaultOpenType: (data.defaultOpenType as FileOpenType) ?? DEFAULT_SETTINGS.defaultOpenType,
		setActive: (data.setActive as boolean) ?? DEFAULT_SETTINGS.setActive,
		enableAutoMetadata: (data.enableAutoMetadata as boolean) ?? DEFAULT_SETTINGS.enableAutoMetadata,
		metadataNamespace: (data.metadataNamespace as string) ?? DEFAULT_SETTINGS.metadataNamespace,
		metadataProperties: (data.metadataProperties as string) ?? DEFAULT_SETTINGS.metadataProperties,
	};
}

/**
 * This class is the plugins settings tab.
 */
export class DailyOrbitSettingTab extends PluginSettingTab {
	plugin: DailyOrbitPlugin;

	constructor(app: App, plugin: DailyOrbitPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		// === Calendars Section ===
		containerEl.createEl("h3", { text: "Calendars" });

		// Add Calendar button
		new Setting(containerEl)
			.setName("Add calendar")
			.setDesc("Add a new custom calendar source.")
			.addButton(btn => btn
				.setButtonText("+ Add Calendar")
				.setCta()
				.onClick(async () => {
					const calendar: CalendarSource = {
						id: generateCalendarId(),
						sourceType: "custom",
						name: "New Calendar",
						enabled: true,
						rootFolder: "",
						...DEFAULT_CALENDAR_SETTINGS,
					};
					this.plugin.settings.calendars.push(calendar);
					await this.plugin.saveSettings();
					this.plugin.rebuildTimewalkService();
					this.display(); // Refresh UI
				}));

		// Render each calendar
		for (const calendar of this.plugin.settings.calendars) {
			this.renderCalendarSection(containerEl, calendar);
		}

		// === General Section ===
		containerEl.createEl("h3", { text: "General" });

		// Set active
		new Setting(containerEl)
			.setName('Open files as active')
			.setDesc('Make files active when they are opened.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.setActive)
				.onChange(async value => {
					this.plugin.settings.setActive = value;
					this.plugin.saveSettings();
				}));

		// File open type
		new Setting(containerEl)
			.setName('Open in')
			.setDesc('Where to open files.')
			.addDropdown(dropdown => dropdown
				.addOptions(toRecord(FILE_OPEN_TYPES.map((item) => item)))
				.setValue(this.plugin.settings.defaultOpenType)
				.onChange(async (value: FileOpenType) => {
					this.plugin.settings.defaultOpenType = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// Auto-metadata section
		containerEl.createEl("h3", { text: "Auto-metadata" });

		// Enable auto-metadata toggle
		new Setting(containerEl)
			.setName('Enable auto-metadata')
			.setDesc('Automatically populate frontmatter properties when opening daily notes.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableAutoMetadata)
				.onChange(async (value) => {
					this.plugin.settings.enableAutoMetadata = value;
					await this.plugin.saveSettings();
				}));

		// Metadata namespace input
		new Setting(containerEl)
			.setName('Metadata namespace')
			.setDesc('Prefix for auto-generated properties (e.g., "dn-" creates "dn-date", "dn-week", etc.).')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.metadataNamespace)
				.setValue(this.plugin.settings.metadataNamespace)
				.onChange(async (value) => {
					if (value.trim() === "") {
						value = DEFAULT_SETTINGS.metadataNamespace;
					}
					this.plugin.settings.metadataNamespace = value;
					await this.plugin.saveSettings();
				}));

		// Metadata properties configuration
		new Setting(containerEl)
			.setName('Metadata properties')
			.setDesc('Configure which properties to create and their format. One per line: "key: template". Available tokens: {YYYY} (year), {MM} (month), {DD} (day), {WW} (week), {WYYYY} (week year), {ddd} (day name), {MMM} (month name), and more.')
			.addTextArea(text => {
				text
					.setPlaceholder(DEFAULT_SETTINGS.metadataProperties)
					.setValue(this.plugin.settings.metadataProperties)
					.onChange(async (value) => {
						this.plugin.settings.metadataProperties = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 8;
				text.inputEl.cols = 50;
			});
	}

	private renderCalendarSection(containerEl: HTMLElement, calendar: CalendarSource) {
		const isDailyNotes = calendar.sourceType === "daily-notes";

		// Use <details> for collapsible section
		const details = containerEl.createEl('details', { cls: 'daily-orbit-calendar-section' });
		const summary = details.createEl('summary', { cls: 'daily-orbit-calendar-section__summary' });

		// Summary row: calendar name + type badge + controls
		const summaryLabel = summary.createSpan({ cls: 'daily-orbit-calendar-section__label' });
		summaryLabel.createSpan({ text: calendar.name });
		summaryLabel.createSpan({
			cls: 'daily-orbit-calendar-section__badge',
			text: isDailyNotes ? 'core plugin' : 'custom',
		});

		// Controls in the summary row (toggle + delete) — stop click propagation so they don't toggle <details>
		const controls = summary.createSpan({ cls: 'daily-orbit-calendar-section__controls' });

		// Enable toggle
		const toggleSetting = new Setting(controls);
		toggleSetting.addToggle(toggle => toggle
			.setValue(calendar.enabled)
			.setTooltip('Enable/disable this calendar')
			.onChange(async (value) => {
				calendar.enabled = value;
				await this.plugin.saveSettings();
				this.plugin.rebuildTimewalkService();
				this.plugin.rerenderNavbars();
			}));
		// Prevent toggle clicks from collapsing/expanding the details
		controls.addEventListener('click', (e) => e.stopPropagation());

		if (!isDailyNotes) {
			toggleSetting.addButton(btn => btn
				.setButtonText("Delete")
				.setWarning()
				.onClick(async () => {
					if (!window.confirm(`Delete calendar "${calendar.name}"? This cannot be undone.`)) return;
					this.plugin.settings.calendars = this.plugin.settings.calendars.filter(c => c.id !== calendar.id);
					await this.plugin.saveSettings();
					this.plugin.rebuildTimewalkService();
					this.display();
				}));
		}

		// Collapsible body
		const body = details.createDiv({ cls: 'daily-orbit-calendar-section__body' });

		// Name (editable for custom calendars)
		if (!isDailyNotes) {
			new Setting(body)
				.setName('Name')
				.addText(text => text
					.setValue(calendar.name)
					.onChange(async (value) => {
						calendar.name = value || "Unnamed Calendar";
						await this.plugin.saveSettings();
					}));
		}

		// Root folder
		if (isDailyNotes) {
			new Setting(body)
				.setName('Root folder')
				.setDesc('Auto-detected from Daily Notes core plugin (read-only).')
				.addText(text => {
					text.setValue(calendar.rootFolder);
					text.setDisabled(true);
				});
		} else {
			new Setting(body)
				.setName('Root folder')
				.setDesc('Vault-relative path to scan for daily notes.')
				.addSearch(search => {
					search.setPlaceholder('e.g., folder/subfolder')
						.setValue(calendar.rootFolder)
						.onChange(async (value) => {
							calendar.rootFolder = value;
							await this.plugin.saveSettings();
							this.plugin.rebuildTimewalkService();
							this.plugin.rerenderNavbars();
						});
					new FolderSuggest(this.app, search.inputEl);
				});
		}

		// Date format
		new Setting(body)
			.setName('Display date format')
			.setDesc('Date format for the orbit buttons.')
			.addText(text => text
				.setPlaceholder(DEFAULT_CALENDAR_SETTINGS.dateFormat)
				.setValue(calendar.dateFormat)
				.onChange(async (value) => {
					calendar.dateFormat = value.trim() === "" ? DEFAULT_CALENDAR_SETTINGS.dateFormat : value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// Tooltip date format
		new Setting(body)
			.setName('Tooltip date format')
			.setDesc('Date format shown when hovering over orbit buttons.')
			.addText(text => text
				.setPlaceholder(DEFAULT_CALENDAR_SETTINGS.tooltipDateFormat)
				.setValue(calendar.tooltipDateFormat)
				.onChange(async (value) => {
					calendar.tooltipDateFormat = value.trim() === "" ? DEFAULT_CALENDAR_SETTINGS.tooltipDateFormat : value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// First day of week
		new Setting(body)
			.setName('First day of week')
			.setDesc('The first day in the orbit bar.')
			.addDropdown(dropdown => dropdown
				.addOptions(toRecord(FIRST_DAY_OF_WEEK.map((item) => item)))
				.setValue(calendar.firstDayOfWeek)
				.onChange(async (value: FirstDayOfWeek) => {
					calendar.firstDayOfWeek = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// Navbar mode
		new Setting(body)
			.setName('Navbar mode')
			.setDesc('Weekly shows a fixed 7-day week. Global shows all daily notes in a scrollable timeline.')
			.addDropdown(dropdown => dropdown
				.addOptions(toRecord(NAVBAR_MODES.map((item) => item)))
				.setValue(calendar.navbarMode)
				.onChange(async (value: NavbarMode) => {
					calendar.navbarMode = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));
	}
}
