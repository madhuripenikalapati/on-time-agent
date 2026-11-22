// Which days a medicine is taken. Shared by the server and the browser.
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Days are stored as text: "daily", "alt" (every other day, counted from startDate), or any
// set of weekdays as "mon,wed,fri" (one weekday, "sun", is a weekly dose). Older plans may hold
// "mon-thu", which means "mon,thu".
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Shown Monday first, as Indian calendars and prescriptions do.
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** The canonical form of a days value, or null if it isn't one. */
export function normalizeDays(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'daily' || text === 'alt') return text;
  const parts = (text === 'mon-thu' ? 'mon,thu' : text).split(/[\s,]+/).filter(Boolean);
  if (!parts.length || parts.some(part => !WEEKDAYS.includes(part))) return null;
  const set = new Set(parts);
  if (set.size === 7) return 'daily';
  return WEEKDAYS.filter(day => set.has(day)).join(',');
}
export const isDays = value => normalizeDays(value) !== null;

/** The weekdays (0 = Sunday) a days value covers; null for "alt", which depends on the date. */
export function weekdaysOf(days) {
  const value = normalizeDays(days);
  if (value === 'daily') return [0, 1, 2, 3, 4, 5, 6];
  if (!value || value === 'alt') return value === 'alt' ? null : [];
  return value.split(',').map(day => WEEKDAYS.indexOf(day));
}

export function runsOn(days, weekday) {
  const list = weekdaysOf(days);
  return list === null ? true : list.includes(weekday);
}

export function dosesPerWeek(days) {
  const list = weekdaysOf(days);
  return list === null ? 3.5 : list.length;
}

const joinWords = words => words.length < 2 ? words.join('') : words.slice(0, -1).join(', ') + ' and ' + words.at(-1);

/** In words, for the agent and the family: "every day", "on Monday, Wednesday and Friday only". */
export function daysLabel(days) {
  const value = normalizeDays(days);
  if (value === 'daily') return 'every day';
  if (value === 'alt') return 'every other day (alternate days)';
  const list = weekdaysOf(value);
  if (!list?.length) return '';
  const names = WEEK_ORDER.filter(d => list.includes(d)).map(d => NAMES[d]);
  return list.length === 1 ? 'once a week, on ' + names[0] + ' only' : list.length + ' days a week, on ' + joinWords(names) + ' only';
}

/** Short, for the editor: "Every day", "3 days a week: Mon, Wed, Fri". */
export function daysSummary(days) {
  const value = normalizeDays(days);
  if (value === 'daily') return 'Every day';
  if (value === 'alt') return 'Every other day';
  const list = weekdaysOf(value);
  if (!list?.length) return '';
  const names = WEEK_ORDER.filter(d => list.includes(d)).map(d => SHORT[d]);
  return list.length === 1 ? 'Once a week: ' + names[0] : list.length + ' days a week: ' + names.join(', ');
}
export const WEEKDAY_SHORT = SHORT;

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
  if (c && c.state !== 'active') return false;
  if (normalizeDays(medicine.days) === 'alt') {
    // Every other day, counted from the first day (the start date; today if none was set).
    if (!isDate(medicine.startDate) || !isDate(today)) return true;
    const since = dayNumber(today) - dayNumber(medicine.startDate);
    return since >= 0 && since % 2 === 0;
  }
  return runsOn(medicine.days, weekday);
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
