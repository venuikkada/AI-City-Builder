// Number formatting. Rupee amounts use lakh/crore, everything else k/M.

export function formatMoney(value, symbol = '$') {
  const n = Math.round(value);
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  let body;
  if (symbol === '₹') {
    if (abs >= 1e7) body = `${(abs / 1e7).toFixed(abs >= 1e8 ? 0 : 2)} Cr`;
    else if (abs >= 1e5) body = `${(abs / 1e5).toFixed(abs >= 1e6 ? 1 : 2)} L`;
    else body = abs.toLocaleString('en-IN');
  } else if (abs >= 1e6) body = `${(abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
  else if (abs >= 1e5) body = `${Math.round(abs / 1e3)}k`;
  else body = abs.toLocaleString('en-US');
  return `${sign}${symbol}${body}`;
}

export function formatSignedMoney(value, symbol) {
  const n = Math.round(value);
  return `${n >= 0 ? '+' : ''}${formatMoney(n, symbol)}`;
}

export function formatNumber(value) {
  const n = Math.round(value);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e5) return `${Math.round(n / 1e3)}k`;
  return n.toLocaleString('en-US');
}

export const percent = (fraction) => `${Math.round(fraction * 100)}%`;
