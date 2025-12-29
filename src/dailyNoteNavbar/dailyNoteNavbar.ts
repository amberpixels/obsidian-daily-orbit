import { ButtonComponent, MarkdownView, Notice, Menu, moment, Keymap } from "obsidian";
import { getDatesInWeekByDate } from "../utils";
import { FileOpenType } from "../types";
import { FILE_OPEN_TYPES_MAPPING, FILE_OPEN_TYPES_TO_PANE_TYPE } from "./consts";
import { createDailyNote } from 'obsidian-daily-notes-interface';
import DailyNoteNavbarPlugin from "../main";

export default class DailyNoteNavbar {
	id: string;
	date: moment.Moment;
	weekOffset = 0;
	plugin: DailyNoteNavbarPlugin;
	containerEl: HTMLElement;
	parentEl: HTMLElement;
	view: MarkdownView;

	constructor(plugin: DailyNoteNavbarPlugin, id: string, view: MarkdownView, parentEl: HTMLElement, date: moment.Moment) {
		this.id = id;
		this.date = date;
		this.weekOffset = 0;
		this.plugin = plugin;
		this.view = view;

		this.containerEl = createDiv();
		this.containerEl.addClass("daily-note-navbar");
		this.containerEl.setAttribute("daily-note-navbar-id", this.id);
		this.parentEl = parentEl;
		this.parentEl.appendChild(this.containerEl);

		// Remove navbar when view unloads
		this.view.onunload = () => this.plugin.removeNavbar(this.id);

		this.rerender();
	}

	rerender() {
		// Update date from view if it has changed
		const activeFile = this.view.file;
		if (activeFile) {
			const fileDate = this.plugin.timewalkService.getDailyNoteDate(activeFile);
			if (fileDate && fileDate.format("YYYY-MM-DD") !== this.date.format("YYYY-MM-DD")) {
				this.date = fileDate;
				this.weekOffset = 0;
			}
		}
		this.containerEl.replaceChildren();

		const currentDate = moment();
		const displayDate = this.date.clone().add(this.weekOffset, "week");
		const dates = getDatesInWeekByDate(displayDate, this.plugin.settings.firstDayOfWeek);

		// Calculate week number
		const weekNumber = this.getWeekNumber(displayDate);

		// Calculate edge dates (prev/next day outside current week)
		const prevEdgeDate = dates[0].clone().subtract(1, 'day');
		const nextEdgeDate = dates[6].clone().add(1, 'day');
		const prevEdgeExists = this.plugin.timewalkService.hasDailyNote(prevEdgeDate);
		const nextEdgeExists = this.plugin.timewalkService.hasDailyNote(nextEdgeDate);

		// ========== ROW 1: Week number + navigation + dates ==========

		// Week number label
		const weekNumberEl = this.containerEl.createSpan({
			cls: "daily-note-navbar__week-number",
			text: `W${weekNumber}`
		});
		weekNumberEl.setAttribute('title', 'Click to jump to today');
		weekNumberEl.addEventListener('click', () => {
			this.weekOffset = 0;
			this.rerender();
		});

		// Previous week button
		new ButtonComponent(this.containerEl)
			.setClass("daily-note-navbar__change-week")
			.setClass("daily-note-navbar__prev-week")
			.setIcon("left-arrow")
			.setTooltip("Previous week")
			.onClick(() => {
				this.weekOffset--;
				this.rerender();
			});

		// Daily note buttons
		for (const date of dates) {
			const dateString = date.format("YYYY-MM-DD");
			const isActive = this.date.format("YYYY-MM-DD") === dateString;
			const isCurrent = currentDate.format("YYYY-MM-DD") === dateString;
			const exists = this.plugin.timewalkService.hasDailyNote(date);
			const stateClass = isActive ? "daily-note-navbar__active" : exists ? "daily-note-navbar__default" : "daily-note-navbar__not-exists";

			const button = new ButtonComponent(this.containerEl)
				.setClass("daily-note-navbar__date")
				.setClass(stateClass)
				.setButtonText(`${date.format(this.plugin.settings.dateFormat)} ${date.date()}`)
				.setTooltip(`${date.format(this.plugin.settings.tooltipDateFormat)}`);
			if (isCurrent) {
				button.setClass("daily-note-navbar__current");
			}

			// Add click handler
			button.buttonEl.onClickEvent((event: MouseEvent) => {
				// Don't navigate to non-existent files
				if (!exists) {
					return;
				}

				const paneType = Keymap.isModEvent(event);
				if (paneType && paneType !== true) {
					const openType = FILE_OPEN_TYPES_TO_PANE_TYPE[paneType];
					this.plugin.openDailyNote(date, openType);
				} else if (event.type === "click") {
					const openType = event.ctrlKey ? "New tab" : this.plugin.settings.defaultOpenType;
					// Skip as it is already open
					const isActive = this.date.format("YYYY-MM-DD") === date.format("YYYY-MM-DD");
					if (isActive && openType === "Active") {
						return;
					}
					this.plugin.openDailyNote(date, openType);
				} else if (event.type === "auxclick") {
					this.createContextMenu(event, date);
				}
			});
		}

		// Next week button
		new ButtonComponent(this.containerEl)
			.setClass("daily-note-navbar__change-week")
			.setClass("daily-note-navbar__next-week")
			.setIcon("right-arrow")
			.setTooltip("Next week")
			.onClick(() => {
				this.weekOffset++;
				this.rerender();
			});

		// ========== ROW 2: Edge dates + create buttons ==========

		// Spacer for week number column
		this.containerEl.createSpan({ cls: "daily-note-navbar__spacer" });

		// Previous edge date button
		this.createEdgeDateButton(prevEdgeDate, prevEdgeExists, "daily-note-navbar__edge-prev");

		// Create buttons or spacers for each date
		for (const date of dates) {
			const exists = this.plugin.timewalkService.hasDailyNote(date);
			if (!exists) {
				this.createCreateButton(date);
			} else {
				this.containerEl.createSpan({ cls: "daily-note-navbar__spacer" });
			}
		}

		// Next edge date button
		this.createEdgeDateButton(nextEdgeDate, nextEdgeExists, "daily-note-navbar__edge-next");
	}

	createContextMenu(event: MouseEvent, date: moment.Moment) {
		const menu = new Menu()

		for (const [openType, itemValues] of Object.entries(FILE_OPEN_TYPES_MAPPING)) {
			menu.addItem(item => item
				.setIcon(itemValues.icon)
				.setTitle(itemValues.title)
				.onClick(async () => {
					this.plugin.openDailyNote(date, openType as FileOpenType);
				}))
		}

		menu.addSeparator();

		menu.addItem(item => item
			.setIcon("copy")
			.setTitle("Copy Obsidian URL")
			.onClick(async () => {
				// Try to find existing file first, otherwise create it
				let dailyNote = this.plugin.timewalkService.findDailyNote(date);
				if (!dailyNote) {
					dailyNote = await createDailyNote(date);
				}
				const extensionLength = dailyNote.extension.length > 0 ? dailyNote.extension.length + 1 : 0;
				const fileName = encodeURIComponent(dailyNote.path.slice(0, -extensionLength));
				const vaultName = this.plugin.app.vault.getName();
				const url = `obsidian://open?vault=${vaultName}&file=${fileName}`;
					navigator.clipboard.writeText(url);
				new Notice("URL copied to your clipboard");
			}));

		menu.showAtMouseEvent(event)
	}

	private getWeekNumber(date: moment.Moment): number {
		if (this.plugin.settings.firstDayOfWeek === "Monday") {
			return date.week(); // ISO week (Monday-based)
		} else {
			// Sunday-based: calculate weeks from first Sunday of year
			const startOfYear = date.clone().startOf('year');
			const firstSunday = startOfYear.clone().day(0);
			if (firstSunday.isAfter(startOfYear)) {
				firstSunday.subtract(7, 'days');
			}
			const daysSinceFirstSunday = date.diff(firstSunday, 'days');
			return Math.floor(daysSinceFirstSunday / 7) + 1;
		}
	}

	private createEdgeDateButton(date: moment.Moment, exists: boolean, additionalClass: string): void {
		const button = new ButtonComponent(this.containerEl)
			.setClass("daily-note-navbar__edge-date")
			.setClass(additionalClass)
			.setButtonText(date.format("ddd DD"))
			.setTooltip(date.format(this.plugin.settings.tooltipDateFormat));

		if (!exists) {
			button.setClass("daily-note-navbar__edge-not-exists");
		}

		button.buttonEl.onClickEvent((event: MouseEvent) => {
			if (!exists) {
				return;
			}

			const paneType = Keymap.isModEvent(event);
			if (paneType && paneType !== true) {
				const openType = FILE_OPEN_TYPES_TO_PANE_TYPE[paneType];
				this.plugin.openDailyNote(date, openType);
			} else if (event.type === "click") {
				const openType = event.ctrlKey ? "New tab" : this.plugin.settings.defaultOpenType;
				this.plugin.openDailyNote(date, openType);
			} else if (event.type === "auxclick") {
				this.createContextMenu(event, date);
			}
		});
	}

	private createCreateButton(date: moment.Moment): void {
		const button = new ButtonComponent(this.containerEl)
			.setClass("daily-note-navbar__create-btn")
			.setButtonText("+")
			.setTooltip(`Create note for ${date.format(this.plugin.settings.tooltipDateFormat)}`)
			.onClick(async () => {
				try {
					await this.plugin.openDailyNote(date, this.plugin.settings.defaultOpenType);
				} catch (error) {
					console.error('[Daily Note Navbar] Failed to create note:', error);
					new Notice('Failed to create daily note');
				}
			});
	}
}
