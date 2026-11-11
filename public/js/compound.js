// Compounding math shared by the server (require) and the browser (window.Compound).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Compound = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY_MS = 86400000;
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  // Days that have actually been credited so far. Daily plans credit every day,
  // monthly plans every 30 days; at maturity the full term is always credited.
  function creditedDays(elapsedDays, durationDays, compounding) {
    const d = Math.max(0, Math.min(elapsedDays, durationDays));
    if (d >= durationDays) return durationDays;
    if (compounding === 'monthly') return Math.floor(d / 30) * 30;
    return Math.floor(d);
  }

  // value = P * (1 + APY)^(days / 365)
  function valueAt(principal, apyPercent, durationDays, compounding, elapsedDays) {
    const d = creditedDays(elapsedDays, durationDays, compounding);
    return round2(principal * Math.pow(1 + apyPercent / 100, d / 365));
  }

  function maturityValue(principal, apyPercent, durationDays) {
    return round2(principal * Math.pow(1 + apyPercent / 100, durationDays / 365));
  }

  // APY needed to reach `multiple` x in `durationDays` (2x in 1460 days = 18.92%).
  function apyForMultiple(multiple, durationDays) {
    return (Math.pow(multiple, 365 / durationDays) - 1) * 100;
  }

  function multiple(apyPercent, durationDays) {
    return Math.pow(1 + apyPercent / 100, durationDays / 365);
  }

  return { DAY_MS, round2, creditedDays, valueAt, maturityValue, apyForMultiple, multiple };
});
