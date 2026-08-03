import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"

// Absolute hardcoded contrast override — bypasses the theme's Tailwind
// CSS-variable colors entirely. This calendar always renders as a solid
// white card with literal hex text/background colors, regardless of
// light/dark app theme, so it can never end up low-contrast again.
const CALENDAR_STYLES = {
  caption_label: { color: "#000000" },
  head_cell: { color: "#000000" },
  day: { color: "#000000" },
  day_selected: { backgroundColor: "#2563eb", color: "#ffffff" },
  day_outside: { color: "#94a3b8" },
  day_disabled: { color: "#94a3b8" },
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}) {
  return (
    (<DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      style={{ backgroundColor: "#ffffff", color: "#000000", padding: "12px", borderRadius: "8px" }}
      styles={CALENDAR_STYLES}
      classNames={{
        months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
        month: "space-y-4",
        caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-medium",
        nav: "space-x-1 flex items-center",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100"
        ),
        nav_button_previous: "absolute left-1",
        nav_button_next: "absolute right-1",
        table: "w-full border-collapse space-y-1",
        head_row: "flex",
        head_cell: "rounded-md w-8 font-normal text-[0.8rem]",
        row: "flex w-full mt-2",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-normal aria-selected:opacity-100"
        ),
        day_range_start: "day-range-start",
        day_range_end: "day-range-end",
        // Colors for caption_label/head_cell/day/day_selected/day_outside/
        // day_disabled all come from the `styles` prop above (literal hex,
        // not Tailwind text-*/bg-* utilities) — see CALENDAR_STYLES. These
        // classNames now only carry layout/behavior, never color, so there's
        // no second color source left to conflict with the hardcoded one.
        day_selected: "hover:opacity-90 focus:opacity-90",
        day_today: "bg-accent !text-accent-foreground",
        day_outside: "day-outside aria-selected:bg-accent/50",
        day_disabled: "opacity-50",
        day_range_middle:
          "aria-selected:bg-accent aria-selected:text-accent-foreground",
        day_hidden: "invisible",
        ...classNames,
      }}
      components={{
        IconLeft: ({ className, ...props }) => (
          <ChevronLeft className={cn("h-4 w-4", className)} {...props} />
        ),
        IconRight: ({ className, ...props }) => (
          <ChevronRight className={cn("h-4 w-4", className)} {...props} />
        ),
      }}
      {...props} />)
  );
}
Calendar.displayName = "Calendar"

export { Calendar }
