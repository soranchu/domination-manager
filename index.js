const SerialPort = require('serialport');
const awsIot = require('aws-iot-device-sdk');
const Oled = require('oled-spi');
const font = require('oled-font-5x7');
const moment = require('moment');
const os = require('os');
const Gpio = require('onoff').Gpio;
const statusText = "";

const buttons = {
  center: new Gpio(2, 'in', 'both'),
  up: new Gpio(27, 'in', 'both'),
  right: new Gpio(4, 'in', 'both'),
  left: new Gpio(17, 'in', 'both'),
  down: new Gpio(3, 'in', 'both')
};
process.on('SIGINT', function () {
  buttons.center.unexport();
  buttons.up.unexport();
  buttons.left.unexport();
  buttons.right.unexport();
  buttons.down.unexport();
});

let uartBuffer = '';
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
  oled.setCursor(0,15);
  oled.writeString(font, 1, `IP:${ip}`, 1, true);
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
    }
  });
});

const shadow = awsIot.thingShadow({
   keyPath: 'certs/domination-manager.private.key',
  certPath: 'certs/domination-manager.cert.pem',
    caPath: 'certs/root-CA.crt',
  clientId: 'domination-manager',
      host: 'a3vm3lk3ajo7lu.iot.ap-northeast-1.amazonaws.com'
});

const uart = new SerialPort('/dev/ttyS0', {
  baudRate: 19200
}, (err) => {
  if (err) {
    return console.log('Error: ', err.message);
  }
});

uart.write('RDNN\r\n', function(err) {
  if (err) {
    return console.log('Error on write: ', err.message);
  }
  console.log('message written');
});

uart.on('data', (data) => {
//  console.log(`[UART] received: "${data}"`);
  uartBuffer += data;
  let lines = uartBuffer.split(/\r\n/);

  if (lines.length === 1) { // no crlf
    return;
  }
  for (var i = 0; i < lines.length - 1; ++i) {
    console.log(`[UART] message:${lines[i]}`);
    let status = parseUart(lines[i]);
    if (status) {
      publishStatus(status);
    }
  }
  uartBuffer = lines[lines.length - 1];
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
  if (data.indexOf('OK') === 0 || data.indexOf('NG') === 0) {
    // TODO
    return;
  }
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
    body: {
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
    }
  };
  return out;
}

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