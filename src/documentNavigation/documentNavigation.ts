import { MarkdownView, moment } from "obsidian";
import DailyNoteNavbarPlugin from "../main";

export default class DocumentNavigation {
	plugin: DailyNoteNavbarPlugin;
	view: MarkdownView;
	currentDate: moment.Moment;
	prevBtn: HTMLElement | null = null;
	nextBtn: HTMLElement | null = null;
	h1Wrapper: HTMLElement | null = null;
	originalH1Parent: HTMLElement | null = null;
	originalH1: HTMLElement | null = null;

	constructor(plugin: DailyNoteNavbarPlugin, view: MarkdownView, date: moment.Moment) {
		this.plugin = plugin;
		this.view = view;
		this.currentDate = date;
		this.render();
	}

	render() {
		// Find first H1 in rendered content (Reading view or Live Preview)
		// Only target actual H1 elements, not editor line markers
		const h1Elements = this.view.contentEl.querySelectorAll('h1');
		if (h1Elements.length === 0) {
			return;
		}

		const firstH1 = h1Elements[0] as HTMLElement;

		// Skip if H1 has no text content
		if (!firstH1.textContent || firstH1.textContent.trim() === '') {
			return;
		}
		this.originalH1 = firstH1;
		this.originalH1Parent = firstH1.parentElement;

		// Create wrapper for H1 and buttons
		this.h1Wrapper = createDiv({ cls: 'doc-nav-h1-wrapper' });

		// Get prev/next notes
		const prevNote = this.plugin.timewalkService.getPreviousDailyNote(this.currentDate);
		const nextNote = this.plugin.timewalkService.getNextDailyNote(this.currentDate);

		// Create prev button if there's a previous note
		if (prevNote) {
			this.prevBtn = createEl('button', {
				cls: 'doc-nav-btn doc-nav-prev',
				text: '<'
			});
			this.prevBtn.setAttribute('aria-label', 'Previous daily note');
			this.prevBtn.onclick = () => {
				this.plugin.openFile(prevNote, 'Active');
			};
			this.h1Wrapper.appendChild(this.prevBtn);
		}

		// Move H1 into wrapper
		firstH1.parentElement?.insertBefore(this.h1Wrapper, firstH1);
		this.h1Wrapper.appendChild(firstH1);

		// Create next button if there's a next note
		if (nextNote) {
			this.nextBtn = createEl('button', {
				cls: 'doc-nav-btn doc-nav-next',
				text: '>'
			});
			this.nextBtn.setAttribute('aria-label', 'Next daily note');
			this.nextBtn.onclick = () => {
				this.plugin.openFile(nextNote, 'Active');
			};
			this.h1Wrapper.appendChild(this.nextBtn);
		}
	}

	destroy() {
		// Restore original H1 position
		if (this.originalH1 && this.originalH1Parent && this.h1Wrapper) {
			// Move H1 back to original parent
			this.originalH1Parent.insertBefore(this.originalH1, this.h1Wrapper);
			// Remove wrapper
			this.h1Wrapper.remove();
		}

		// Clean up references
		this.prevBtn = null;
		this.nextBtn = null;
		this.h1Wrapper = null;
		this.originalH1 = null;
		this.originalH1Parent = null;
	}
}
