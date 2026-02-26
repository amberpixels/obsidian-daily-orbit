export const FIRST_DAY_OF_WEEK = ["Monday", "Sunday"] as const;
export type FirstDayOfWeek = typeof FIRST_DAY_OF_WEEK[number];

export const FILE_OPEN_TYPES = ["Active", "New tab", "New window", "Split right", "Split down"] as const;
export type FileOpenType = (typeof FILE_OPEN_TYPES)[number];

export const NAVBAR_MODES = ["weekly", "global"] as const;
export type NavbarMode = typeof NAVBAR_MODES[number];

export type CalendarSourceType = "daily-notes" | "custom";

export interface CalendarSource {
  id: string;              // auto-generated UUID
  sourceType: CalendarSourceType;
  name: string;            // display name (e.g., "Daily Notes", "Westside Dev")
  enabled: boolean;        // user can disable without deleting

  // For "daily-notes": auto-read from core plugin, shown read-only
  // For "custom": user enters manually
  rootFolder: string;      // vault-relative path (e.g., "0C. Calendarish")

  // Per-calendar display settings:
  dateFormat: string;
  tooltipDateFormat: string;
  firstDayOfWeek: FirstDayOfWeek;
  navbarMode: NavbarMode;
}
