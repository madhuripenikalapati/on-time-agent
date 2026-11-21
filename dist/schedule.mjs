// Which days a medicine is taken. Shared by the server and the browser.
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const DAY_OPTIONS = [
  ['daily', 'Every day'],
  ['mon-thu', 'Monday & Thursday'],
  ...WEEKDAYS.map((day, index) => [day, 'Once a week · ' + NAMES[index]]),
];
export const DAY_VALUES = DAY_OPTIONS.map(([value]) => value);

export function runsOn(days, weekday) {
  if (days === 'daily') return true;
  if (days === 'mon-thu') return weekday === 1 || weekday === 4;
  return WEEKDAYS.indexOf(days) === weekday;
}

export function dosesPerWeek(days) {
  return days === 'daily' ? 7 : days === 'mon-thu' ? 2 : 1;
}

export function daysLabel(days) {
  if (days === 'daily') return 'every day';
  if (days === 'mon-thu') return 'only on Monday and Thursday';
  const index = WEEKDAYS.indexOf(days);
  return index < 0 ? '' : 'once a week, on ' + NAMES[index] + ' only';
}

// Courses: "for 10 days, then stop". Dates are India calendar days, 'YYYY-MM-DD'.
const dayNumber = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000;
export const addDays = (date, n) => new Date((dayNumber(date) + n) * 86_400_000).toISOString().slice(0, 10);
export const isDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(dayNumber(value));

/** @returns {null | {day, total, ends, state: 'upcoming'|'active'|'finished', last: boolean}} */
export function course(medicine, today) {
  if (!medicine.courseDays || !isDate(medicine.startDate) || !isDate(today)) return null;
  const day = dayNumber(today) - dayNumber(medicine.startDate) + 1;
  return {
    day,
    total: medicine.courseDays,
    ends: addDays(medicine.startDate, medicine.courseDays - 1),
    state: day < 1 ? 'upcoming' : day > medicine.courseDays ? 'finished' : 'active',
    last: day === medicine.courseDays,
  };
}

// Is this medicine due on this date? Weekday rule and course window together.
export function takenOn(medicine, today) {
  const weekday = new Date(dayNumber(today) * 86_400_000).getUTCDay();
  const c = course(medicine, today);
  return runsOn(medicine.days, weekday) && (!c || c.state === 'active');
}

// Doses still to come in a course (from today, inclusive), or null for an ongoing medicine.
export function dosesLeftInCourse(medicine, today) {
  const c = course(medicine, today);
  if (!c) return null;
  if (c.state === 'finished') return 0;
  let count = 0;
  for (let d = Math.max(1, c.day); d <= c.total; d++) {
    if (takenOn(medicine, addDays(medicine.startDate, d - 1))) count++;
  }
  return count;
}
