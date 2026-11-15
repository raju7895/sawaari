/* Checks the mobile number helpers.
 *
 *   node scripts/check-phone.js
 *
 * The number has to reach Supabase in one form — "+919876543210" — and it
 * has to be the same string that is used to send the code and to check
 * it. A number with spaces, a leading zero or no country code is refused
 * by the Auth service, and the error only turns up after the visitor has
 * typed their number.
 */
import { toE164, isValidE164, formatPhone, nationalNumber } from '../web/src/lib/phone.js';

const CASES = [
  // what was typed            → what has to be sent
  ['9876543210', '+919876543210'],
  ['09876543210', '+919876543210'],
  ['+91 98765 43210', '+919876543210'],
  ['+91-98765-43210', '+919876543210'],
  ['+919876543210', '+919876543210'],
  ['  98765 43210  ', '+919876543210'],
  ['+14155552671', '+14155552671'],          // another country is left alone
  ['', ''],
  [null, ''],
];

let failed = 0;

for (const [input, expected] of CASES) {
  const got = toE164(input);
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${JSON.stringify(input)} → ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

const CHECKS = [
  ['isValidE164("+919876543210")', isValidE164('+919876543210'), true],
  ['isValidE164("9876543210")', isValidE164('9876543210'), false],
  ['isValidE164("+9198765")', isValidE164('+9198765'), false],
  ['formatPhone("+919876543210")', formatPhone('+919876543210'), '+91 98765 43210'],
  ['formatPhone("9876543210")', formatPhone('9876543210'), '+91 98765 43210'],
  ['nationalNumber("+919876543210")', nationalNumber('+919876543210'), '9876543210'],
];

for (const [label, got, expected] of CHECKS) {
  const ok = got === expected;
  if (!ok) failed += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label} → ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

if (failed) {
  console.log(`  ${failed} check(s) failed`);
  process.exit(1);
}
console.log('  every mobile number is put into one form');
