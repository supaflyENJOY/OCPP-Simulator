const child_process = require('child_process');
const { steveUrl, chargersCount } = require('./meta.js');

function chargerGetId(index) {
  return `CHARGE_BOX_PERF_TEST_${index}`;
}

let chargersProcesses = [];
for (let i = 0; i < chargersCount; i++) {
  const child = child_process.fork(
    './gir-ocppjs.js',
    [
      'start_cp',
      steveUrl,
      chargerGetId(i),
    ],
  );
  child.on('close', exitHandler);
  chargersProcesses.push(child);
}

function exitHandler() {
  chargersProcesses.forEach(child => child.kill());
}

process.on('exit', exitHandler);
process.on('SIGINT', exitHandler);
process.on('SIGUSR1', exitHandler);
process.on('SIGUSR2', exitHandler);
