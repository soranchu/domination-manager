const authToken = '481543597758447bad554dba0e48fb06';
const awsIot = require('aws-iot-device-sdk');
const Oled = require('oled-spi');
const font = require('oled-font-5x7');
const moment = require('moment');
require("moment-duration-format");
const os = require('os');
const ChildProcess = require('child_process');
const Gpio = require('onoff').Gpio;
const Im920 = require('./im920');
const BlynkLib = require('blynk-library');
const blynk = new BlynkLib.Blynk(authToken)

const gameStatus = {
  totalSeconds: 60 * 7,
  remainingMs: 0,
  started: false,
  redScore: 0,
  yellowScore: 0,
  nodes: []
};
gameStatus.remainingMs = gameStatus.totalSeconds * 1000;

let lastTimestamp = 0;
let uiMode = 0;
let gameControlState = 'PAUSE';
const im = new Im920('/dev/ttyS0');

const buttons = {
  center: new Gpio(2, 'in', 'both'),
  up: new Gpio(27, 'in', 'both'),
  right: new Gpio(4, 'in', 'both'),
  left: new Gpio(17, 'in', 'both'),
  down: new Gpio(3, 'in', 'both')
};
const buzzer = new Gpio(25, 'out');

process.on('SIGINT', function () {
  buttons.center.unexport();
  buttons.up.unexport();
  buttons.left.unexport();
  buttons.right.unexport();
  buttons.down.unexport();
  buzzer.unexport();
  process.exit();
});

let ctrl = {
  pauseStatusUpload: false,
  started: false,
  reset: false
};

// pin assignment
const pins = {
  //game timer
  timer: new blynk.VirtualPin(0),
  nodes: [
    {
      name: 'Alpha',
      r: new blynk.WidgetLED(1),
      y: new blynk.WidgetLED(4)
    },
    {
      name: 'Bravo',
      r: new blynk.WidgetLED(2),
      y: new blynk.WidgetLED(5)
    },
    {
      name: 'Charlie',
      r: new blynk.WidgetLED(3),
      y: new blynk.WidgetLED(6)
    }
  ],
  redScore: new blynk.VirtualPin(7),
  yellowScore: new blynk.VirtualPin(10),

  startNewGame: new blynk.VirtualPin(20),
  resetGame: new blynk.VirtualPin(21),
  pauseGame: new blynk.VirtualPin(12),

  //TODO: NOT implemeted
  // gameDuration: new blynk.VirtualPin(9),
  // gameDurationConfig: new blynk.VirtualPin(11),

};

var opts = {
  width: 128,
  height: 64,
  dcPin: 23,
  rstPin : 24
};

var oled = new Oled(opts);
buzzer.writeSync(1);
oled.begin(function(){
  console.log('oled init');
  buzzer.writeSync(0);
  // do cool oled things here
  oled.clearDisplay();
  oled.turnOnDisplay();
  drawTime();
});

function wait (msec) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, msec);
  });
}

function getAddr () {
  let nw = os.networkInterfaces();
  let ip = null;

  if (nw.wlan0) {
    nw.wlan0.forEach((detail) => {
      if (detail.family === 'IPv4') {
        ip = detail.address;
      }
    });
  }
  return ip;
}

function getApName () {
  try {
    let ap = ChildProcess.execSync('iwgetid -r').toString();
    return ap;
  } catch (e) {
    console.error(`get AP failed: ${e}`);
    return null;
  }
}

let st = false;
function drawTime () {
  updateStatus();

  let m = moment.duration(gameStatus.remainingMs);
  oled.setCursor(0,0);
  oled.fillRect(0, 0, 128, 24, 0);
  if (st) {
    oled.writeString(font, 2, m.format('mm:ss', {trim: false}), 1, false);
  } else {
    oled.writeString(font, 2, m.format('mm:ss.', {trim: false}), 1, false);
  }
  st = !st;
  oled.setCursor(90,0);
  oled.writeString(font, 1, gameControlState, 1, false);

  oled.setCursor(0, 56);
  oled.fillRect(0, 56, 128, 8, 0);
  switch (uiMode) {
    case 0: //ip
    { 
      let ip = getAddr() || '0.0.0.0';
      oled.writeString(font, 1, `IP:${ip}`, 1, false);
      break;
    }
    case 1: // ap
    {
      let ap = getApName();
      oled.writeString(font, 1, `AP:${ap}`, 1, false);
      break;
    }
    case 2: // rssi
    {
      let s = gameStatus.nodes;
      let rssi = [];
      for (let i = 0; i < 3; ++i) {
        rssi[i] = s[i] ? s[i].rssi : '-NA';
      }
      oled.writeString(font, 1, `A${rssi[0]} B${rssi[1]} C${rssi[2]}`, 1, false);
      break;
    }
  }
  let rp = zeroPadding(Math.floor(gameStatus.redScore/5), 4);
  let yp = zeroPadding(Math.floor(gameStatus.yellowScore/5), 4);
  oled.setCursor(1,16);
  oled.writeString(font, 1, `SUM: R:${rp} Y:${yp}`, false);
  wait(1000).then(drawTime);
}

function updateStatus () {
  let redScore = 0;
  let yellowScore = 0;
  let current = new Date().getTime();
  let diff = current - lastTimestamp;

  gameStatus.nodes.forEach((s) => {
    if (s && s.teams) {
      redScore += s.teams.red.point;
      yellowScore += s.teams.yellow.point;
    }
  });
  gameStatus.redScore = redScore;
  gameStatus.yellowScore = yellowScore;
  if (gameStatus.started) {
    if (gameStatus.remainingMs - diff <= 0) {
      let winner = (redScore > yellowScore) ? 'RED' : 'YELLOW';
      gameFinish(winner);
    } else {
      gameStatus.remainingMs -= diff;
    }
  }
  lastTimestamp = current;

  sendStatusToNodes();

  let ts = moment.duration(gameStatus.remainingMs).format("mm:ss", { trim: false });
  pins.timer.write(ts);
  gameStatus.nodes.forEach((n, i) => {
    switch(n.currentColor) {
      case '00': //red
        pins.nodes[i].r.turnOn();
        pins.nodes[i].y.turnOff();
        break;
      case '01': //yel
        pins.nodes[i].r.turnOff();
        pins.nodes[i].y.turnOn();
        break;
      default:
        pins.nodes[i].r.turnOff();
        pins.nodes[i].y.turnOff();
        break;
    }
  });
  pins.redScore.write(Math.floor(gameStatus.redScore/5));
  pins.yellowScore.write(Math.floor(gameStatus.yellowScore/5));
}

['center', 'up', 'left', 'right', 'down'].forEach((key) => {
  buttons[key].watch((err, value) => {
    buzzer.writeSync(0);
    console.log(key, err, value);
    if (value === 0) {
      exec(key);
    }
  });
});

function exec (key) {
  let msg = null;
  switch(key) {
    case 'center':
      msg = 'start';
      break;
    case 'up':
      msg = 'pause';
      break;
    case 'down':
      msg = 'reset';
      break;
    case 'right':
      if (uiMode >= 2) uiMode = 0;
      else uiMode++;
      break;
    case 'left':
      if (uiMode === 0) uiMode = 2;
      else uiMode--;
      break;
  }
  if (msg) {
    gameControl(msg);
  }
}

function gameControl (state) {
  switch(state) {
    case 'start':
      gameControlState = 'START';
      im.txData('01'); // game start
      //im.txData('01'); // game start
      //im.txData('01'); // game start
      gameStatus.started = true;
      lastTimestamp = new Date().getTime();
      break;
    case 'pause':
      gameControlState = 'PAUSE';
      im.txData('02'); // game pause
      //im.txData('02'); // game pause
      //im.txData('02'); // game pause
      gameStatus.started = false;
      break;
    case 'reset':
      gameControlState = 'RESET';
      im.txData('09'); // game reset
      //im.txData('09'); // game reset
      //im.txData('09'); // game reset
      gameStatus.remainingMs = 1000 * gameStatus.totalSeconds;
      gameStatus.started = false;
      let ts = moment.duration(gameStatus.remainingMs).format("mm:ss", { trim: false });
      pins.timer.write(ts);
      pins.nodes.forEach((n) => {
        n.r.turnOff();
        n.y.turnOff();
      });
      pins.redScore.write(0);
      pins.yellowScore.write(0);
      break;
  }
  oled.setCursor(90,0);
  oled.fillRect(90, 0, 38, 8);
  oled.writeString(font, 1, gameControlState, 1, false);
}

function gameStart () {
  gameControl('start');
}

function gamePause () {
  gameControl('pause');
}

function gameReset () {
  gameControl('reset');
}

function gameFinish (team) {
  gameControl('pause');
  gameStatus.remainingMs = 0;
  buzzer.writeSync(1);
  wait(10*1000).then(() => {
    buzzer.writeSync(0);
  });
  blynk.notify('game finished! '+ team +' wins.');
}

function zeroPadding(number, length){
  return number.toLocaleString( "ja-JP", {useGrouping: false , minimumIntegerDigits: length});
}

im.onDataReceived((data) => {
  let status = parseUart(data);
  if (!status) return;
  let base = 31;
  let id = 0;
  let key = '';
  switch (status.no) {
     case '02': id = 0; key = 'A'; base = 31; break; 
     case '03': id = 1; key = 'B'; base = 31 + 8; break; 
     case '08': id = 2; key = 'C'; base = 31 + 16; break; 
  }
  gameStatus.nodes[id] = status;
  oled.fillRect(0, base, 127, 8, 0);
  
  let current = '_';
  if (status.currentColor === '00') current = 'R';
  if (status.currentColor === '01') current = 'Y';

  if (status.started) {
    oled.drawPixel([
      [0, base + 1, 1], [1, base + 1, 0], [2, base + 1, 0], [3, base + 1, 0], [4, base + 1, 0],
      [0, base + 2, 1], [1, base + 2, 1], [2, base + 2, 1], [3, base + 2, 0], [4, base + 2, 0],
      [0, base + 3, 1], [1, base + 3, 1], [2, base + 3, 1], [3, base + 3, 1], [4, base + 3, 1],
      [0, base + 4, 1], [1, base + 4, 1], [2, base + 4, 1], [3, base + 4, 0], [4, base + 4, 0],
      [0, base + 5, 1], [1, base + 5, 0], [2, base + 5, 0], [3, base + 5, 0], [4, base + 5, 0],
    ]);
  } else {
    oled.drawPixel([
      [0, base + 1, 1], [1, base + 1, 1], [2, base + 1, 1], [3, base + 1, 1], [4, base + 1, 1],
      [0, base + 2, 1], [1, base + 2, 1], [2, base + 2, 1], [3, base + 2, 1], [4, base + 2, 1],
      [0, base + 3, 1], [1, base + 3, 1], [2, base + 3, 1], [3, base + 3, 1], [4, base + 3, 1],
      [0, base + 4, 1], [1, base + 4, 1], [2, base + 4, 1], [3, base + 4, 1], [4, base + 4, 1],
      [0, base + 5, 1], [1, base + 5, 1], [2, base + 5, 1], [3, base + 5, 1], [4, base + 5, 1],
    ]);
  }
  oled.setCursor(8,base);
  let rp = zeroPadding(Math.floor(status.teams.red.point/5), 4);
  let yp = zeroPadding(Math.floor(status.teams.yellow.point/5), 4);
  oled.writeString(font, 1, `${key}:${current} R:${rp} Y:${yp}`, 1, false);
    
});
function fromHex (str) {
  if (Array.isArray(str)) {
    let s = '0x';
    for (let i = str.length -1; i >= 0; --i) {
      s += str[i];
    }
    return parseInt(s);
  } else {
    return parseInt('0x' + str);
  }
}

function sendStatusToNodes () {
  let b = new Buffer(10);
  b[0] = 0x00; // CMD_SEND_STATUS
  b.writeUInt32LE(gameStatus.remainingMs, 1); // 1-4
  b.writeUInt16LE(gameStatus.redScore, 5); // 5-6
  b.writeUInt16LE(gameStatus.yellowScore, 7); // 7-8
  switch (gameControlState) {
    case 'START': b[9] = 0x01; break;
    case 'PAUSE': b[9] = 0x02; break;
    case 'RESET': b[9] = 0x09; break;
  }
  im.txData(b.toString('hex'));
}

function parseUart (data) {
  let t = data.split(':');
  if (t.length === 1) {
    // TODO 
    return;
  }
  let headers = t[0].split(',');
  let body = t[1].split(',');
  if (body.length < 8) {
    return;
  }
  let out = {
    no: headers[0],
    id: headers[1],
    rssi: fromHex(headers[2]) - 0x100,
    currentColor: body[0],
    teams: {
      red: {
        tags: fromHex(body[1]),
        point: fromHex([body[3], body[4]])
      },
      yellow: {
        tags: fromHex(body[2]),
        point: fromHex([body[5], body[6]])
      }
    },
    started: body[7] !== '00',
    //clock: fromHex([body[8], body[9], body[10], body[11]])
  };
  return out;
}

const shadow = awsIot.thingShadow({
   keyPath: 'certs/domination-manager.private.key',
  certPath: 'certs/domination-manager.cert.pem',
    caPath: 'certs/root-CA.crt',
  clientId: 'domination-manager',
      host: 'a3vm3lk3ajo7lu.iot.ap-northeast-1.amazonaws.com'
});

function publishStatus (status) {
  shadow.update('domination-manager', {state: {reported: status}});
}

shadow.on('connect', function() {
  //
  // After connecting to the AWS IoT platform, register interest in the
  // Thing Shadow named 'RGBLedLamp'.
  //
  shadow.register( 'domination-manager', {}, function() {

    // Once registration is complete, update the Thing Shadow named
    // 'RGBLedLamp' with the latest device state and save the clientToken
    // so that we can correlate it with status or timeout events.
    //
    // Thing shadow state
    //
    var newState = {
      state: {
        reported: {
          status: 'connected'
        }
      }
    };

    clientTokenUpdate = shadow.update('domination-manager', newState  );
    //
    // The update method returns a clientToken; if non-null, this value will
    // be sent in a 'status' event when the operation completes, allowing you
    // to know whether or not the update was successful.  If the update method
    // returns null, it's because another operation is currently in progress and
    // you'll need to wait until it completes (or times out) before updating the 
    // shadow.
    //
    if (clientTokenUpdate === null) {
      console.log('update shadow failed, operation still in progress');
    }
  });
});
shadow.on('status', 
  function(thingName, stat, clientToken, stateObject) {
    console.log('received '+stat+' on '+thingName+': ' + JSON.stringify(stateObject));
    //
    // These events report the status of update(), get(), and delete() 
    // calls.  The clientToken value associated with the event will have
    // the same value which was returned in an earlier call to get(),
    // update(), or delete().  Use status events to keep track of the
    // status of shadow operations.
    //
  }
);

shadow.on('delta', 
  function(thingName, stateObject) {
    console.log('received delta on '+thingName+': '+
                   JSON.stringify(stateObject));
    let desired = stateObject.state;
    if (desired) {
      if (desired.ctrl !== undefined) {
        if (desired.ctrl.start !== undefined) {
          if (desired.ctrl.start) {
            console.log('[UART] sending START');
            uart.write('TXDA 01\r\n');
            console.log('[UART] sending START DONE');
            ctrl.start = true;
          } else {
            console.log('[UART] sending PAUSE');
            uart.write('TXDA 02\r\n');
            console.log('[UART] sending PAUSE DONE');
            ctrl.start = false;
          }
        }
        if (desired.ctrl.reset !== undefined) {
          if (desired.ctrl.reset) {
            console.log('[UART] sending CFG');
            uart.write('TXDA 09\r\n');
            console.log('[UART] sending CFG DONE');
            ctrl.reset = true;
          } else {
            ctrl.reset = false;
          }
        }
        shadow.update('domination-manager', {state: {reported: {ctrl: ctrl}}});
      }
    }
  }
);

shadow.on('timeout',
  function(thingName, clientToken) {
    console.log('received timeout on '+thingName+
                   ' with token: '+ clientToken);
    //
    // In the event that a shadow operation times out, you'll receive
    // one of these events.  The clientToken value associated with the
    // event will have the same value which was returned in an earlier
    // call to get(), update(), or delete().
    //
  }
);

//UI component bindings
//
pins.startNewGame.on('write', function(){
  gameStart();
});

pins.resetGame.on('write', function(){
  gameReset();
});

pins.pauseGame.on('write', function(param){
  if(!gameStatus.started){
    console.log('you cannot pause before game start!');
    return;
  }
  if(param == 0){
    console.log('game resume');
    gameStart();
  }else if(param == 1){
    console.log('game pause');
    gamePause();
  }
});
