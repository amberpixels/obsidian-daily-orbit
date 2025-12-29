import { App, PluginSettingTab, Setting } from "obsidian";
import { FirstDayOfWeek, FIRST_DAY_OF_WEEK, FileOpenType, FILE_OPEN_TYPES, NavbarMode, NAVBAR_MODES } from "./types";
import { toRecord } from "./utils";
import DailyNoteBarPlugin from "./main";

export interface DailyNoteNavbarSettings {
	dateFormat: string;
	tooltipDateFormat: string;
	firstDayOfWeek: FirstDayOfWeek;
	navbarMode: NavbarMode;
	globalViewportSize: number;
	defaultOpenType: FileOpenType;
	setActive: boolean;
	enableAutoMetadata: boolean;
	metadataNamespace: string;
	metadataProperties: string; // Multi-line text: "key: template" per line
}

/**
 * The plugins default settings.
 */
export const DEFAULT_SETTINGS: DailyNoteNavbarSettings = {
	dateFormat: "ddd",
	tooltipDateFormat: "YYYY-MM-DD",
	firstDayOfWeek: "Monday",
	navbarMode: "weekly",
	globalViewportSize: 10,
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
 * This class is the plugins settings tab.
 */
export class DailyNoteNavbarSettingTab extends PluginSettingTab {
	plugin: DailyNoteBarPlugin;

	constructor(app: App, plugin: DailyNoteBarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		// Date format
		new Setting(containerEl)
			.setName('Display date format')
			.setDesc('Date format for the daily note navbar buttons.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.dateFormat)
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					if (value.trim() === "") {
						value = DEFAULT_SETTINGS.dateFormat;
					}
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// Tooltip date format
		new Setting(containerEl)
			.setName('Tooltip date format')
			.setDesc('Date format shown when hovering over navbar buttons.')
			.addText(text => text
				.setPlaceholder(DEFAULT_SETTINGS.tooltipDateFormat)
				.setValue(this.plugin.settings.tooltipDateFormat)
				.onChange(async (value) => {
					if (value.trim() === "") {
						value = DEFAULT_SETTINGS.tooltipDateFormat;
					}
					this.plugin.settings.tooltipDateFormat = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// First day of week
		new Setting(containerEl)
			.setName('First day of week')
			.setDesc('The first day in the daily note bar.')
			.addDropdown(dropdown => dropdown
				.addOptions(toRecord(FIRST_DAY_OF_WEEK.map((item) => item)))
				.setValue(this.plugin.settings.firstDayOfWeek)
				.onChange(async (value: FirstDayOfWeek) => {
					this.plugin.settings.firstDayOfWeek = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

		// Navbar mode
		new Setting(containerEl)
			.setName('Navbar mode')
			.setDesc('Display mode for daily note navigation. Weekly shows a fixed 7-day week. Global shows all daily notes in a scrollable timeline.')
			.addDropdown(dropdown => dropdown
				.addOptions(toRecord(NAVBAR_MODES.map((item) => item)))
				.setValue(this.plugin.settings.navbarMode)
				.onChange(async (value: NavbarMode) => {
					this.plugin.settings.navbarMode = value;
					await this.plugin.saveSettings();
					this.plugin.rerenderNavbars();
				}));

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
}
