/**
 * ⚠️  ACTION REQUIRED — replace the placeholder values below with your real
 * WELMES wire-transfer details before going live. These are the exact numbers
 * buyers copy to pay by bank transfer, so a wrong value means a lost payment.
 *
 * Any account whose `accountNumber` still contains "XXXX" is treated as a
 * placeholder: the checkout shows a warning and disables the bank-transfer
 * "Place Order" button so no one pays into a fake account.
 */
export interface BankAccount {
  currency: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  swiftCode: string;
  routingNumber?: string;
  note: string;
}

export const BANK_ACCOUNTS: BankAccount[] = [
  {
    currency: 'USD',
    bankName: 'Airwallex / JPMorgan Chase',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'XXXX-XXXX-XXXX',
    swiftCode: 'XXXXUS33',
    routingNumber: '021000021',
    note: 'For USD wire transfers',
  },
  {
    currency: 'JPY',
    bankName: 'Airwallex / MUFG Bank',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'XXXX-XXXXXXX',
    swiftCode: 'BOTKJPJT',
    note: 'For JPY wire transfers',
  },
  {
    currency: 'EUR',
    bankName: 'Airwallex / Barclays',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'GB00 BARC XXXX XXXX XXXX XX',
    swiftCode: 'BARCGB22',
    note: 'For EUR wire transfers (IBAN)',
  },
];

/** True while the account still holds placeholder (XXXX) digits. */
export const isPlaceholderAccount = (a: BankAccount): boolean =>
  /X{3,}/i.test(a.accountNumber) || /X{3,}/i.test(a.swiftCode);
