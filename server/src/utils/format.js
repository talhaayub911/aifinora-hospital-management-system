export const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
export const normalizeCode = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
export const normalizeReference = (value) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export const jsonText = (value) => (value === undefined ? null : JSON.stringify(value));

export const decimalNumber = (value) => (value == null ? null : Number(value));

export const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Number(days));
  return next;
};

export const addBillingPeriod = (date, billingCycle) => {
  const source = new Date(date);
  const monthsToAdd = String(billingCycle).toUpperCase() === 'ANNUAL' ? 12 : 1;
  const absoluteMonth = source.getUTCMonth() + monthsToAdd;
  const targetYear = source.getUTCFullYear() + Math.floor(absoluteMonth / 12);
  const targetMonth = ((absoluteMonth % 12) + 12) % 12;
  const lastTargetDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const next = new Date(source);
  next.setUTCDate(1);
  next.setUTCFullYear(targetYear);
  next.setUTCMonth(targetMonth);
  next.setUTCDate(Math.min(source.getUTCDate(), lastTargetDay));
  return next;
};

export const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

export const publicUser = (user, kind = 'hospital') => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  mobile: user.mobile ?? null,
  role: kind === 'platform' ? user.role : user.role?.key,
  roleName: kind === 'platform' ? user.role : user.role?.name,
  hospitalId: user.hospitalId ?? null,
  mustChangePassword: user.mustChangePassword ?? false,
});
