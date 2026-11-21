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
