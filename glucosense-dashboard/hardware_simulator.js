import { WebSocketServer } from 'ws';
import * as readline from 'readline';

const PORT = 81;
const wss = new WebSocketServer({ port: PORT });

console.log(`\n=========================================`);
console.log(` GlucoSense Hardware Simulator started!`);
console.log(` WebSocket Server running on port ${PORT}`);
console.log(`=========================================\n`);
console.log(`Waiting for dashboard connection...`);

const rand = (min, max) => min + Math.random() * (max - min);

const ACTIVITIES = [
  "fasting", "before_breakfast", "after_breakfast", "before_lunch",
  "after_lunch", "before_dinner", "after_dinner", "random"
];

let connectedWs = null;

wss.on('connection', function connection(ws) {
  console.log(`\n[+] Dashboard connected!`);
  connectedWs = ws;
  
  ws.send(JSON.stringify({
    type: "event",
    message: "Simulator Connected"
  }));

  console.log(`\n💡 INSTRUCTION:`);
  console.log(`Press ENTER here to simulate placing a finger and instantly sending a reading to History.`);
  console.log(`-------------------------------------------------\n`);

  ws.on('message', function message(data) {
    try {
      const msg = JSON.parse(data);
      if (msg.type === "setContext") {
        console.log(`\n[i] Received Patient Demographics: Age ${msg.age}, Gender ${msg.gender===1?'M':'F'}, BMI ${msg.bmi.toFixed(1)}`);
      }
    } catch(e){}
  });

  ws.on('close', () => {
    console.log(`[-] Dashboard disconnected.`);
    connectedWs = null;
  });
  
  ws.on('error', console.error);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.on('line', () => {
  if (!connectedWs) {
    console.log(`[!] No dashboard is connected yet. Connect first!`);
    return;
  }

  connectedWs.send(JSON.stringify({
    type: "event",
    message: "Finger detected"
  }));
  console.log(`[>] Sent event: Finger detected... Processing reading...`);

  setTimeout(() => {
    const activity = ACTIVITIES[Math.floor(Math.random() * ACTIVITIES.length)];
    
    const heartRate = Math.round(rand(60, 90));
    const spO2 = +(rand(96, 99.5)).toFixed(1);
    const ratio = +(rand(0.35, 0.85)).toFixed(3);
    
    let baseGlucose = rand(80, 110);
    if (activity.includes("after")) baseGlucose += rand(30, 60);

    const reading = {
      type: "reading",
      glucose: +baseGlucose.toFixed(1),
      heartRate: heartRate,
      spO2: spO2,
      ratio: ratio,
      variability: Math.round(rand(5000, 20000)),
      activity: activity,
      timestamp: Date.now()
    };

    connectedWs.send(JSON.stringify(reading));
    console.log(`[>] Auto-logged reading: Glucose ${reading.glucose} mg/dL | HR: ${reading.heartRate}`);
    console.log(`\nPress ENTER to send another scan...`);

  }, 1000); // 1-second process time
});
