import { parseResetTime, getLastResetTime } from './utils/zoomTime.js';

function runTests() {
  console.log('Testing zoomTime.ts utility:');

  const cases = [
    { timeStr: '09:00 AM', expectedHrs: 9, expectedMins: 0 },
    { timeStr: '12:00 AM', expectedHrs: 0, expectedMins: 0 },
    { timeStr: '12:30 PM', expectedHrs: 12, expectedMins: 30 },
    { timeStr: '06:45 PM', expectedHrs: 18, expectedMins: 45 },
    { timeStr: '11:59 PM', expectedHrs: 23, expectedMins: 59 }
  ];

  for (const c of cases) {
    const res = parseResetTime(c.timeStr);
    const pass = res.hours === c.expectedHrs && res.minutes === c.expectedMins;
    console.log(`- Time: "${c.timeStr}" -> parseResult: ${res.hours}:${res.minutes} (Pass: ${pass})`);
  }

  // Test getLastResetTime
  console.log('\nTesting getLastResetTime:');
  const now = new Date();
  const reset09AM = getLastResetTime('09:00 AM');
  console.log(`- Current Time: ${now.toString()}`);
  console.log(`- Last 09:00 AM Reset Time: ${reset09AM.toString()}`);
  
  const reset06PM = getLastResetTime('06:00 PM');
  console.log(`- Last 06:00 PM Reset Time: ${reset06PM.toString()}`);
}

runTests();
