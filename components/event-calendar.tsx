"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";

export type EventCalendarItem = {
  id: string;
  title: string;
  start?: string;
  end?: string;
  allDay: boolean;
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
  return (
    <FullCalendar
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      height="auto"
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
