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
};

export function EventCalendar({ events, onEventClick }: EventCalendarProps) {
  return (
    <FullCalendar
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      height="auto"
      events={events}
      eventClick={onEventClick ? (info) => onEventClick(info.event.id) : undefined}
      eventCursor={onEventClick ? "pointer" : undefined}
    />
  );
}
