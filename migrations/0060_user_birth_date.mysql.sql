/**
 * A user's date of birth (YYYY-MM-DD), optional. Kept on the account so any
 * plugin can check an age (classes, age-restricted products) without asking
 * again. Personal data: shown to the member and to administrators, included
 * in data exports, and removed with the account.
 */
ALTER TABLE users ADD COLUMN birth_date VARCHAR(10) NULL;
