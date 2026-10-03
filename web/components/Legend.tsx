export function Legend() {
  return (
    <dl className="legend" aria-label="Column keys">
      <div><dt>LNCH</dt><dd>launches with a finished 10-slot window</dd></div>
      <div><dt>SNP10</dt><dd>median share of the curve&rsquo;s sellable supply bought by non-creator wallets in slots 0&ndash;9</dd></div>
      <div><dt>CI</dt><dd>90% bootstrap interval of that median</dd></div>
      <div><dt>GRAD</dt><dd>share graduated, among pools at least 24 h old</dd></div>
      <div><dt>T-GRAD</dt><dd>median time from launch to graduation</dd></div>
    </dl>
  );
}
