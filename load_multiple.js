const child_process = require('child_process');
const { steveUrl, chargersCount } = require('./meta.js');

function chargerGetId(index) {
  return `CHARGE_BOX_PERF_TEST_${index}`;
}

for (let i=0; i < chargersCount; i++) {
  child_process.fork('./gir-ocppjs.js',
    [
      'start_cp',
      steveUrl,
      chargerGetId(i)
    ]);
}
