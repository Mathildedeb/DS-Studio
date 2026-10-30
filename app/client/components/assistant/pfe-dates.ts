function dayNumber(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
export function daysRemaining(date: string, now: Date) {
  return (
    dayNumber(date) -
    dayNumber(`${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`)
  );
}
