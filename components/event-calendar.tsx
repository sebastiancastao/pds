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
};

export function EventCalendar({ events }: EventCalendarProps) {
  return (
    <FullCalendar
      plugins={[dayGridPlugin]}
      initialView="dayGridMonth"
      height="auto"
      events={events}
    />
  );
}
