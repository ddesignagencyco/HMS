/* Pure validation shared by the client forms and the server actions. Kept free
   of any Node import so it can be bundled into a client component. */

export const normalisePhone = (value: string) => value.replace(/[\s-]/g, "");

export const isValidPhone = (value: string) => /^03\d{9}$/.test(normalisePhone(value));

export const isValidPassword = (value: string) => value.length >= 8 && /\d/.test(value);

export const isValidName = (value: string) => value.trim().length >= 2;

export const isValidOtp = (value: string) => /^\d{6}$/.test(value.trim());

export const maskPhone = (value: string) => {
  const digits = normalisePhone(value);
  return digits.length === 11 ? `${digits.slice(0, 4)} ••••• ${digits.slice(-3)}` : value;
};
