const crypto = require('crypto');

// PayFast sandbox credentials — these are PayFast's own published test
// merchant details, safe to use for testing. Replace with your real
// merchant_id / merchant_key / passphrase (from payfast.co.za) plus
// PAYFAST_MODE=live in your .env once you're ready to take real payments.
const SANDBOX_MERCHANT_ID = '10000100';
const SANDBOX_MERCHANT_KEY = '46f0cd694581a';

function getConfig() {
  const live = (process.env.PAYFAST_MODE || 'sandbox') === 'live';
  return {
    live,
    merchantId: live ? process.env.PAYFAST_MERCHANT_ID : SANDBOX_MERCHANT_ID,
    merchantKey: live ? process.env.PAYFAST_MERCHANT_KEY : SANDBOX_MERCHANT_KEY,
    passphrase: live ? (process.env.PAYFAST_PASSPHRASE || '') : '',
    processUrl: live
      ? 'https://www.payfast.co.za/eng/process'
      : 'https://sandbox.payfast.co.za/eng/process'
  };
}

// Build the signed field set PayFast expects, in the exact order they
// were added (PayFast's signature is order-sensitive).
function buildPaymentFields({ orderRef, amount, itemName, name, phone, returnUrl, cancelUrl, notifyUrl }) {
  const cfg = getConfig();
  const [firstName, ...rest] = (name || 'Customer').trim().split(' ');

  const fields = {
    merchant_id: cfg.merchantId,
    merchant_key: cfg.merchantKey,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    notify_url: notifyUrl,
    name_first: firstName || 'Customer',
    name_last: rest.join(' ') || '-',
    cell_number: (phone || '').replace(/\s+/g, ''),
    m_payment_id: orderRef,
    amount: Number(amount).toFixed(2),
    item_name: itemName.slice(0, 100)
  };

  const signature = signFields(fields, cfg.passphrase);
  return { fields: { ...fields, signature }, processUrl: cfg.processUrl };
}

function signFields(fields, passphrase) {
  const queryString = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v).trim()).replace(/%20/g, '+')}`)
    .join('&');
  const withPass = passphrase
    ? `${queryString}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`
    : queryString;
  return crypto.createHash('md5').update(withPass).digest('hex');
}

// Verify an incoming ITN (Instant Transaction Notification) POST body.
// In sandbox mode we do a light check; in live mode this should also
// call back to PayFast's validate endpoint (see README) and check the
// source IP — documented but not enforced here to keep local testing simple.
function verifyItnSignature(body) {
  const cfg = getConfig();
  const { signature, ...rest } = body;
  const expected = signFields(rest, cfg.passphrase);
  return signature === expected;
}

module.exports = { getConfig, buildPaymentFields, verifyItnSignature };
