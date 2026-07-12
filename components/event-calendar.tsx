"use client";

import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";

export type EventCalendarItem = {
  id: string;
  title: string;
  start?: string;
  end?: string;
  allDay: boolean;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
};

type EventCalendarProps = {
  events: EventCalendarItem[];
  onEventClick?: (id: string) => void;
  onVisibleRangeChange?: (range: { start: string; end: string }) => void;
};

const formatDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function EventCalendar({ events, onEventClick, onVisibleRangeChange }: EventCalendarProps) {
  const calendarRef = useRef<FullCalendar | null>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const syncView = () => {
      const compact = mediaQuery.matches;
      setIsCompact(compact);

      const calendarApi = calendarRef.current?.getApi();
      const nextView = compact ? "dayGridWeek" : "dayGridMonth";
      if (calendarApi && calendarApi.view.type !== nextView) {
        calendarApi.changeView(nextView);
      }
    };

    syncView();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncView);
      return () => mediaQuery.removeEventListener("change", syncView);
    }

    mediaQuery.addListener(syncView);
    return () => mediaQuery.removeListener(syncView);
  }, []);

  return (
    <FullCalendar
      ref={calendarRef}
      plugins={[dayGridPlugin]}
      initialView={isCompact ? "dayGridWeek" : "dayGridMonth"}
      height="auto"
      contentHeight="auto"
      expandRows={!isCompact}
      fixedWeekCount={!isCompact}
      showNonCurrentDates={!isCompact}
      dayMaxEvents={isCompact ? 2 : 4}
      moreLinkClick="popover"
      eventDisplay="block"
      headerToolbar={{
        left: "prev,next today",
        center: "title",
        right: "dayGridMonth,dayGridWeek,dayGridDay",
      }}
      buttonText={{
        today: "Today",
        month: "Month",
        week: "Week",
        day: "Day",
      }}
      dayHeaderFormat={isCompact ? { weekday: "short", day: "numeric" } : { weekday: "short" }}
      eventTimeFormat={{
        hour: "numeric",
        minute: "2-digit",
        meridiem: "short",
      }}
      events={events}
      datesSet={(info) => {
        onVisibleRangeChange?.({
          start: formatDateKey(info.view.currentStart),
          end: formatDateKey(info.view.currentEnd),
        });
      }}
      eventDidMount={(info) => {
        if (onEventClick) {
          info.el.style.cursor = "pointer";
        }
      }}
      eventClick={onEventClick ? (info) => onEventClick(info.event.id) : undefined}
    />
  );
}
