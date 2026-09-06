function minuteToTime(minute) {
  if (minute === 1440) return "24:00";
  const hours = String(Math.floor(minute / 60)).padStart(2, "0");
  const minutes = String(minute % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function openingToWire(record) {
  const safe = { isClosed: record.isClosed };
  if (!record.isClosed) {
    safe.openTime = minuteToTime(record.openMinute);
    safe.closeTime = minuteToTime(record.closeMinute);
  }
  return safe;
}

function toSafeWorkshopSchedule(schedule) {
  const weeklyHours = Array.from(schedule.weeklyHours || [])
    .sort((left, right) => left.weekday - right.weekday)
    .map((record) => ({
      weekday: record.weekday,
      ...openingToWire(record),
    }));
  const dateOverrides = Array.from(schedule.dateOverrides || [])
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((record) => ({
      date: record.date,
      ...openingToWire(record),
    }));

  return {
    timeZone: schedule.timeZone,
    slotMinutes: schedule.slotMinutes,
    bayCount: schedule.bayCount,
    weeklyHours,
    dateOverrides,
    updatedAt: schedule.updatedAt instanceof Date
      ? new Date(schedule.updatedAt.getTime())
      : schedule.updatedAt,
  };
}

module.exports = { toSafeWorkshopSchedule };

