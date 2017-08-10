const awsIot = require('aws-iot-device-sdk');
const Oled = require('oled-spi');
const font = require('oled-font-5x7');
const moment = require('moment');
const os = require('os');
const Gpio = require('onoff').Gpio;
const Im920 = require('./im920');
const statusList = [];
const mergedStatus = {};

const im = new Im920('/dev/ttyS0');

const buttons = {
  center: new Gpio(2, 'in', 'both'),
  up: new Gpio(27, 'in', 'both'),
  right: new Gpio(4, 'in', 'both'),
  left: new Gpio(17, 'in', 'both'),
  down: new Gpio(3, 'in', 'both')
};
const buzzer = new Gpio(25, 'out');
buzzer.writeSync(1);

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
var opts = {
  width: 128,
  height: 64,
  dcPin: 23,
  rstPin : 24
};

var oled = new Oled(opts);
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

let st = false;
function drawTime () {
  let m = moment();
  oled.setCursor(0,0);
  if (st) {
    oled.writeString(font, 2, m.format('HH:mm:ss'), 1, false);
  } else {
    oled.writeString(font, 2, m.format('HH:mm:ss.'), 1, false);
  }
  st = !st;
  let ip = getAddr() || '0.0.0.0';
  oled.setCursor(0,56);
  oled.writeString(font, 1, `IP:${ip}`, 1, true);

  mergedStatus.red = 0;
  mergedStatus.yellow = 0;
  statusList.forEach((s) => {
    if (s && s.teams) {
      mergedStatus.red += s.teams.red.point;
      mergedStatus.yellow += s.teams.yellow.point;
    }
  });
  let rp = zeroPadding(Math.floor(mergedStatus.red/5), 4);
  let yp = zeroPadding(Math.floor(mergedStatus.yellow/5), 4);
  oled.setCursor(0,15);
  oled.writeString(font, 1, `RED: ${rp} YEL: ${yp}`, false);
  wait(1000).then(drawTime);
}

['center', 'up', 'left', 'right', 'down'].forEach((key) => {
  buttons[key].watch((err, value) => {
    console.log(key, err, value);
    oled.setCursor(0,23);
    oled.writeString(font, 1, '       ', 1, false);
    if (value === 0) {
      oled.setCursor(0,23);
      oled.writeString(font, 1, key, 1, false);
      exec(key);
    }
  });
});

function exec (key) {
  switch(key) {
    case 'center':
      im.txData('01'); // game start
      im.txData('01'); // game start
      im.txData('01'); // game start
      break;
    case 'up':
      im.txData('02'); // game pause
      im.txData('02'); // game pause
      im.txData('02'); // game pause
      break;
    case 'down':
      im.txData('09'); // game reset
      im.txData('09'); // game reset
      im.txData('09'); // game reset
      break;
  }
}
function zeroPadding(number, length){
  return number.toLocaleString( "ja-JP", {useGrouping: false , minimumIntegerDigits: length});
}

im.onDataReceived((data) => {
  let status = parseUart(data);
  if (!status) return;
  let base = 31;
  let id = 0;
  switch (status.no) {
     case '02': id = 0; base = 31; break; 
     case '03': id = 1; base = 31 + 8; break; 
     case '08': id = 2; base = 31 + 16; break; 
  }
  statusList[id] = status;
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
  oled.writeString(font, 1, `${id}:${current} R:${rp} Y:${yp}`, 1, false);
    
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

function parseUart (data) {
  let t = data.split(':');
  if (t.length === 1) {
    // TODO 
    return;
  }
  let headers = t[0].split(',');
  let body = t[1].split(',');
  if (body.length < 12) {
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
    clock: fromHex([body[8], body[9], body[10], body[11]])
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