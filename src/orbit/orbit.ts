import { ButtonComponent, MarkdownView, Notice, Menu, moment, Keymap, setIcon } from "obsidian";
import { getDatesInWeekByDate } from "../utils";
import { FileOpenType, NavbarMode } from "../types";
import { FILE_OPEN_TYPES_MAPPING, FILE_OPEN_TYPES_TO_PANE_TYPE } from "./consts";
import { createDailyNote } from 'obsidian-daily-notes-interface';
import DailyOrbitPlugin from "../main";
import { buildGlobalTimeline, GlobalNavItem } from "./global-mode-builder";

export default class DailyOrbit {
	id: string;
	date: moment.Moment;
	weekOffset = 0;
	plugin: DailyOrbitPlugin;
	containerEl: HTMLElement;
	parentEl: HTMLElement;
	view: MarkdownView;

	// Global mode state
	mode: NavbarMode;
	globalItems: GlobalNavItem[] = [];
	scrollContainerEl?: HTMLElement;
	floatingHeaderEl?: HTMLElement;
	weekNumberEl?: HTMLElement;
	savedGlobalScrollPosition?: number;
	viewportCenterDate?: moment.Moment; // Shared between modes for position sync
	positionBeforeToday?: { weekOffset: number; viewportCenterDate?: moment.Moment }; // For "back" functionality

	// Floating mode state
	isFloating: boolean = false;
	containerScrollListener?: () => void;
	floatingScrollEl?: HTMLElement;

	constructor(plugin: DailyOrbitPlugin, id: string, view: MarkdownView, parentEl: HTMLElement, date: moment.Moment) {
		this.id = id;
		this.date = date;
		this.weekOffset = 0;
		this.plugin = plugin;
		this.view = view;

		// Initialize mode from settings
		this.mode = plugin.settings.navbarMode;
		this.globalItems = [];

		this.containerEl = createDiv();
		this.containerEl.addClass("daily-orbit");
		this.containerEl.setAttribute("daily-orbit-id", this.id);
		this.parentEl = parentEl;
		this.parentEl.appendChild(this.containerEl);

		// Remove navbar when view unloads
		this.view.onunload = () => {
			if (this.containerScrollListener && this.floatingScrollEl) {
				this.floatingScrollEl.removeEventListener('scroll', this.containerScrollListener);
			}
			this.plugin.removeNavbar(this.id);
		};

		this.rerender();
	}

	rerender() {
		// Save scroll position before rebuilding (for global mode)
		if (this.mode === 'global' && this.scrollContainerEl) {
			this.savedGlobalScrollPosition = this.scrollContainerEl.scrollLeft;
		}

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

		// Row 1: Timeline row (toggle + < + content + >)
		this.renderTimelineRow();

		// Row 2: Position indicator (W50, December 2025, today button)
		this.renderPositionRow();

		// Setup scroll detection for floating behavior
		this.setupFloatingBehavior();
	}

	private setupFloatingBehavior() {
		// Cleanup previous listener
		if (this.containerScrollListener && this.floatingScrollEl) {
			this.floatingScrollEl.removeEventListener('scroll', this.containerScrollListener);
		}

		// Try to find the scrollable container for better accuracy
		let contentEl: HTMLElement | null = null;

		// Try .view-content first
		contentEl = this.view.containerEl.querySelector('.view-content') as HTMLElement;

		// Fallback to looking for scrollable parent
		if (!contentEl) {
			let parent = this.containerEl.parentElement;
			while (parent && parent !== document.body) {
				const hasScroll = parent.scrollHeight > parent.clientHeight;
				const overflowY = window.getComputedStyle(parent).overflowY;
				if (hasScroll && (overflowY === 'auto' || overflowY === 'scroll')) {
					contentEl = parent;
					break;
				}
				parent = parent.parentElement;
			}
		}

		// Store the scroll container element
		this.floatingScrollEl = contentEl || document.body as HTMLElement;

		// Create scroll handler that checks element position
		this.containerScrollListener = () => {
			const rect = this.containerEl.getBoundingClientRect();
			const wasFloating = this.isFloating;

			// Consider floating if the navbar is stuck at the top of the viewport
			// Obsidian's sticky header keeps it at a small offset from top
			this.isFloating = rect.top < 60 && rect.top >= 0;

			if (wasFloating !== this.isFloating) {
				this.updateFloatingState();
			}
		};

		// Attach listener to the scrollable element
		this.floatingScrollEl.addEventListener('scroll', this.containerScrollListener, { passive: true });

		// Set initial state
		const rect = this.containerEl.getBoundingClientRect();
		this.isFloating = rect.top < 60 && rect.top >= 0;
		this.updateFloatingState();
	}

	private updateFloatingState() {
		if (this.isFloating) {
			this.containerEl.addClass('daily-orbit--floating');
		} else {
			this.containerEl.removeClass('daily-orbit--floating');
		}
	}

	// ==================== ROW 2: POSITION ROW (shared) ====================
	private renderPositionRow() {
		const positionRow = this.containerEl.createDiv({
			cls: 'daily-orbit__position-row'
		});

		// Week number (display only)
		const displayDate = this.date.clone().add(this.weekOffset, "week");
		const weekNumber = this.getWeekNumber(displayDate);
		this.weekNumberEl = positionRow.createSpan({
			cls: "daily-orbit__week-number",
			text: `W${weekNumber}`
		});

		// Month/Year label
		this.floatingHeaderEl = positionRow.createSpan({
			cls: 'daily-orbit__floating-header'
		});
		this.updateFloatingHeader(displayDate);

		// Center to today button (smart toggle: go to today / go back)
		const centerBtn = positionRow.createEl('button', {
			cls: 'daily-orbit__header-btn',
			attr: { 'aria-label': 'Go to today', 'title': 'Go to today (click again to go back)' }
		});
		setIcon(centerBtn, 'crosshair');
		centerBtn.addEventListener('click', () => {
			const today = moment();
			const todayWeekOffset = today.diff(this.date, 'weeks');

			// Check if we're currently showing today
			const isAtToday = this.viewportCenterDate?.isSame(today, 'day') ||
				(this.weekOffset === todayWeekOffset && !this.viewportCenterDate);

			if (isAtToday && this.positionBeforeToday) {
				// Already at today - go back to previous position
				this.weekOffset = this.positionBeforeToday.weekOffset;
				this.viewportCenterDate = this.positionBeforeToday.viewportCenterDate;
				this.savedGlobalScrollPosition = undefined;
				this.positionBeforeToday = undefined; // Clear after using
			} else {
				// Save current position and go to today
				this.positionBeforeToday = {
					weekOffset: this.weekOffset,
					viewportCenterDate: this.viewportCenterDate?.clone()
				};
				// Calculate week offset to show today
				this.weekOffset = todayWeekOffset;
				this.viewportCenterDate = today.clone();
				this.savedGlobalScrollPosition = undefined;
			}
			this.rerender();
		});
	}

	// ==================== ROW 1: TIMELINE ROW (shared structure) ====================
	private renderTimelineRow() {
		const timelineRow = this.containerEl.createDiv({
			cls: 'daily-orbit__timeline-row'
		});

		// Mode toggle button
		const toggleBtn = new ButtonComponent(timelineRow)
			.setClass('daily-orbit__mode-toggle')
			.setIcon('list')
			.setTooltip(this.mode === 'weekly' ? 'Switch to timeline view' : 'Switch to week view')
			.onClick(async () => {
				const oldMode = this.mode;
				this.mode = this.mode === 'weekly' ? 'global' : 'weekly';
				this.plugin.settings.navbarMode = this.mode;
				await this.plugin.saveSettings();

				// Sync position between modes
				if (oldMode === 'weekly' && this.mode === 'global') {
					// Weekly → Global: save current week's center date for global to scroll to
					const displayDate = this.date.clone().add(this.weekOffset, "week");
					this.viewportCenterDate = displayDate;
					this.savedGlobalScrollPosition = undefined; // Force scroll to viewportCenterDate
				} else if (oldMode === 'global' && this.mode === 'weekly') {
					// Global → Weekly: calculate weekOffset from viewportCenterDate
					if (this.viewportCenterDate) {
						const diffWeeks = this.viewportCenterDate.diff(this.date, 'weeks');
						this.weekOffset = diffWeeks;
					}
				}

				this.rerender();
			});
		if (this.mode === 'global') {
			toggleBtn.buttonEl.addClass('daily-orbit__mode-toggle--active');
		}

		// Previous button
		new ButtonComponent(timelineRow)
			.setClass("daily-orbit__nav-arrow")
			.setClass("daily-orbit__nav-prev")
			.setIcon("chevron-left")
			.setTooltip(this.mode === 'weekly' ? "Previous week" : "Scroll left")
			.onClick(() => {
				if (this.mode === 'weekly') {
					this.weekOffset--;
					this.viewportCenterDate = this.date.clone().add(this.weekOffset, "week");
					this.rerender();
				} else {
					this.scrollByElements(-3);
				}
			});

		// Content area (mode-specific)
		const contentArea = timelineRow.createDiv({
			cls: 'daily-orbit__content-area'
		});

		if (this.mode === 'global') {
			this.renderGlobalContent(contentArea);
		} else {
			this.renderWeeklyContent(contentArea);
			this.setupWeeklyScrollBehavior(contentArea);
		}

		// Next button
		new ButtonComponent(timelineRow)
			.setClass("daily-orbit__nav-arrow")
			.setClass("daily-orbit__nav-next")
			.setIcon("chevron-right")
			.setTooltip(this.mode === 'weekly' ? "Next week" : "Scroll right")
			.onClick(() => {
				if (this.mode === 'weekly') {
					this.weekOffset++;
					this.viewportCenterDate = this.date.clone().add(this.weekOffset, "week");
					this.rerender();
				} else {
					this.scrollByElements(3);
				}
			});
	}

	private scrollByElements(count: number) {
		if (!this.scrollContainerEl || this.scrollContainerEl.children.length === 0) return;

		// Calculate average element width (including gap)
		const children = Array.from(this.scrollContainerEl.children) as HTMLElement[];
		const totalWidth = children.reduce((sum, el) => sum + el.offsetWidth, 0);
		const gap = 4; // CSS gap value
		const avgItemWidth = (totalWidth / children.length) + gap;

		// Scroll by count elements
		const scrollAmount = avgItemWidth * count;
		this.scrollContainerEl.scrollBy({
			left: scrollAmount,
			behavior: 'smooth'
		});
	}

	private setupWeeklyScrollBehavior(contentArea: HTMLElement) {
		let lastScrollTime = 0;
		const scrollCooldown = 300; // ms between week changes

		contentArea.addEventListener('wheel', (e) => {
			e.preventDefault();

			const now = Date.now();
			if (now - lastScrollTime < scrollCooldown) return;

			if (e.deltaY > 0) {
				this.weekOffset++;
			} else if (e.deltaY < 0) {
				this.weekOffset--;
			}

			// Update viewportCenterDate for mode sync
			this.viewportCenterDate = this.date.clone().add(this.weekOffset, "week");

			lastScrollTime = now;
			this.rerender();
		}, { passive: false });
	}

	// ==================== CONTENT RENDERERS ====================
	private renderWeeklyContent(container: HTMLElement) {
		const currentDate = moment();
		const displayDate = this.date.clone().add(this.weekOffset, "week");
		const dates = getDatesInWeekByDate(displayDate, this.plugin.settings.firstDayOfWeek);

		// Daily note buttons
		for (const date of dates) {
			const dateString = date.format("YYYY-MM-DD");
			const isActive = this.date.format("YYYY-MM-DD") === dateString;
			const isCurrent = currentDate.format("YYYY-MM-DD") === dateString;
			const exists = this.plugin.timewalkService.hasDailyNote(date);
			const stateClass = isActive ? "daily-orbit__active" : exists ? "daily-orbit__default" : "daily-orbit__not-exists";

			// Tooltip: "Create YYYY-MM-DD" for missing, just date for existing
			const tooltipText = exists
				? date.format(this.plugin.settings.tooltipDateFormat)
				: `Create ${date.format(this.plugin.settings.tooltipDateFormat)}`;

			const button = new ButtonComponent(container)
				.setClass("daily-orbit__date")
				.setClass(stateClass)
				.setButtonText(`${date.format(this.plugin.settings.dateFormat)} ${date.date()}`)
				.setTooltip(tooltipText);
			if (isCurrent) {
				button.setClass("daily-orbit__current");
			}

			button.buttonEl.onClickEvent((event: MouseEvent) => {
				const paneType = Keymap.isModEvent(event);
				if (paneType && paneType !== true) {
					const openType = FILE_OPEN_TYPES_TO_PANE_TYPE[paneType];
					this.plugin.openDailyNote(date, openType);
				} else if (event.type === "click") {
					const openType = event.ctrlKey ? "New tab" : this.plugin.settings.defaultOpenType;
					const isActiveNote = this.date.format("YYYY-MM-DD") === date.format("YYYY-MM-DD");
					if (isActiveNote && openType === "Active" && exists) return;
					this.plugin.openDailyNote(date, openType);
				} else if (event.type === "auxclick") {
					this.createContextMenu(event, date);
				}
			});
		}
	}

	private renderGlobalContent(container: HTMLElement) {
		const currentDate = moment();

		// Build timeline
		this.globalItems = buildGlobalTimeline(
			this.plugin.timewalkService,
			this.date,
			currentDate
		);

		// Find active item index for scroll positioning
		const activeIndex = this.globalItems.findIndex(item => item.isActive);

		// Create scroll container inside the content area
		this.scrollContainerEl = container.createDiv({
			cls: 'daily-orbit__scroll-container'
		});

		// Render all items
		this.globalItems.forEach((item) => {
			if (item.type === 'note') {
				this.renderNoteItem(item);
			} else {
				this.renderGapItem(item);
			}
		});

		// Setup scroll behavior
		this.setupGlobalScrollBehavior(activeIndex);
	}

	private updateFloatingHeader(referenceDate: moment.Moment) {
		if (this.floatingHeaderEl) {
			this.floatingHeaderEl.textContent = referenceDate.format('MMMM YYYY');
		}
	}

	private centerOnIndex(index: number) {
		if (!this.scrollContainerEl) return;
		const el = this.scrollContainerEl.children[index] as HTMLElement;
		if (el) {
			const containerWidth = this.scrollContainerEl.offsetWidth;
			const itemLeft = el.offsetLeft;
			const itemWidth = el.offsetWidth;
			this.scrollContainerEl.scrollLeft = itemLeft - (containerWidth / 2) + (itemWidth / 2);
		}
	}

	private setupGlobalScrollBehavior(activeIndex: number) {
		if (!this.scrollContainerEl) return;

		// Detect mobile vs desktop for scroll behavior
		const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

		// Restore saved scroll position or center on target date
		window.requestAnimationFrame(() => {
			if (!this.scrollContainerEl) return;

			// Disable smooth scrolling for instant positioning
			this.scrollContainerEl.style.scrollBehavior = 'auto';

			if (this.savedGlobalScrollPosition !== undefined) {
				// Restore previous scroll position (navigating within global mode)
				this.scrollContainerEl.scrollLeft = this.savedGlobalScrollPosition;
			} else if (this.viewportCenterDate) {
				// Scroll to viewportCenterDate (coming from weekly mode)
				const targetDateStr = this.viewportCenterDate.format('YYYY-MM-DD');
				const targetIndex = this.globalItems.findIndex(item =>
					item.date.format('YYYY-MM-DD') === targetDateStr ||
					(item.type === 'gap' && item.date.isSameOrBefore(this.viewportCenterDate) &&
					item.date.clone().add(item.gapCount || 0, 'days').isAfter(this.viewportCenterDate))
				);
				if (targetIndex !== -1) {
					const targetEl = this.scrollContainerEl.children[targetIndex] as HTMLElement;
					if (targetEl) {
						const containerWidth = this.scrollContainerEl.offsetWidth;
						const itemLeft = targetEl.offsetLeft;
						const itemWidth = targetEl.offsetWidth;
						this.scrollContainerEl.scrollLeft = itemLeft - (containerWidth / 2) + (itemWidth / 2);
					}
				} else if (activeIndex !== -1) {
					// Fallback to active item
					this.centerOnIndex(activeIndex);
				}
			} else if (activeIndex !== -1) {
				// Initial load: center the active item
				this.centerOnIndex(activeIndex);
			}

			// Only re-enable smooth scrolling on mobile (desktop uses JS momentum)
			if (isMobile) {
				window.requestAnimationFrame(() => {
					if (this.scrollContainerEl) {
						this.scrollContainerEl.style.scrollBehavior = 'smooth';
					}
				});
			}
		});

		// Add scroll listener for floating header updates
		this.scrollContainerEl.addEventListener('scroll', () => {
			this.handleScroll();
		});

		if (!isMobile) {
			let velocity = 0;
			let isAnimating = false;
			const friction = 0.92;
			const sensitivity = 0.15;
			const maxVelocity = 130;

			const animateMomentum = () => {
				if (!this.scrollContainerEl) return;

				this.scrollContainerEl.scrollLeft += velocity;
				velocity *= friction;

				if (Math.abs(velocity) > 0.5) {
					window.requestAnimationFrame(animateMomentum);
				} else {
					velocity = 0;
					isAnimating = false;
					// Snap to nearest item when momentum ends
					this.snapToNearestItem();
				}
			};

			this.scrollContainerEl.addEventListener('wheel', (e) => {
				e.preventDefault();
				velocity += e.deltaY * sensitivity;
				velocity = Math.max(-maxVelocity, Math.min(maxVelocity, velocity));

				if (!isAnimating) {
					isAnimating = true;
					animateMomentum();
				}
			}, { passive: false });
		} else {
			this.scrollContainerEl.addEventListener('wheel', (e) => {
				e.preventDefault();
				if (this.scrollContainerEl) {
					this.scrollContainerEl.scrollLeft += e.deltaY;
				}
			}, { passive: false });
		}
	}

	private snapToNearestItem() {
		if (!this.scrollContainerEl || this.scrollContainerEl.children.length === 0) return;

		const children = Array.from(this.scrollContainerEl.children) as HTMLElement[];
		const containerLeft = this.scrollContainerEl.scrollLeft;

		// Find the item closest to the left edge
		let closestItem: HTMLElement | null = null;
		let closestDistance = Infinity;

		for (const child of children) {
			const itemLeft = child.offsetLeft;
			const distance = Math.abs(itemLeft - containerLeft);
			if (distance < closestDistance) {
				closestDistance = distance;
				closestItem = child;
			}
		}

		if (closestItem) {
			this.scrollContainerEl.scrollTo({
				left: closestItem.offsetLeft,
				behavior: 'smooth'
			});
		}
	}

	private renderNoteItem(item: GlobalNavItem) {
		const classes = ['daily-orbit__global-item', 'daily-orbit__global-note'];

		if (item.isActive) classes.push('daily-orbit__active');
		if (item.isCurrent) classes.push('daily-orbit__current');

		const btn = new ButtonComponent(this.scrollContainerEl!)
			.setButtonText(item.date.format('ddd DD'))
			.setTooltip(item.date.format(this.plugin.settings.tooltipDateFormat));

		// Add classes
		classes.forEach(cls => btn.setClass(cls));

		// Click handler (same as weekly mode)
		btn.buttonEl.onClickEvent((event: MouseEvent) => {
			const paneType = Keymap.isModEvent(event);
			if (paneType && paneType !== true) {
				const openType = FILE_OPEN_TYPES_TO_PANE_TYPE[paneType];
				this.plugin.openDailyNote(item.date, openType);
			} else if (event.type === "click") {
				const openType = event.ctrlKey ? "New tab" : this.plugin.settings.defaultOpenType;
				if (item.isActive && openType === "Active") return;
				this.plugin.openDailyNote(item.date, openType);
			} else if (event.type === "auxclick") {
				this.createContextMenu(event, item.date);
			}
		});
	}

	private renderGapItem(item: GlobalNavItem) {
		const count = item.gapCount || 0;

		// Single missing day: render as gray date button (like weekly mode)
		if (count === 1) {
			const btn = new ButtonComponent(this.scrollContainerEl!)
				.setButtonText(item.date.format('ddd DD'))
				.setTooltip(`Create ${item.date.format(this.plugin.settings.tooltipDateFormat)}`);

			btn.setClass('daily-orbit__global-item');
			btn.setClass('daily-orbit__global-note');
			btn.setClass('daily-orbit__global-missing');

			btn.buttonEl.onClickEvent((event: MouseEvent) => {
				const paneType = Keymap.isModEvent(event);
				if (paneType && paneType !== true) {
					const openType = FILE_OPEN_TYPES_TO_PANE_TYPE[paneType];
					this.plugin.openDailyNote(item.date, openType);
				} else if (event.type === "click") {
					const openType = event.ctrlKey ? "New tab" : this.plugin.settings.defaultOpenType;
					this.plugin.openDailyNote(item.date, openType);
				}
			});
			return;
		}

		// 2+ missing days: show ..N.. format
		const text = `..${count}..`;

		const gapEl = this.scrollContainerEl!.createDiv({
			cls: 'daily-orbit__global-item daily-orbit__global-gap',
			text: text
		});

		gapEl.setAttribute('title', `${count} missing days`);
	}

	private handleScroll() {
		if (!this.scrollContainerEl) return;

		// Find which item is currently in viewport center
		const containerRect = this.scrollContainerEl.getBoundingClientRect();
		const centerX = containerRect.left + (containerRect.width / 2);

		// Find item at center
		for (let i = 0; i < this.scrollContainerEl.children.length; i++) {
			const child = this.scrollContainerEl.children[i] as HTMLElement;
			const childRect = child.getBoundingClientRect();

			if (childRect.left <= centerX && childRect.right >= centerX) {
				// This item is centered
				const item = this.globalItems[i];
				if (item && item.date) {
					this.updateFloatingHeader(item.date);
					this.updateWeekNumber(item.date);
					this.viewportCenterDate = item.date.clone(); // Save for mode sync
				}
				break;
			}
		}
	}

	private updateWeekNumber(referenceDate: moment.Moment) {
		if (this.weekNumberEl) {
			const weekNumber = this.getWeekNumber(referenceDate);
			this.weekNumberEl.textContent = `W${weekNumber}`;
		}
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

}
