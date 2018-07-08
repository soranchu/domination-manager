'use strict';
// const promisify = require('es6-promisify');
const SerialPort = require('serialport');

class Command {
  constructor (cmd, resolve, reject) {
    this.cmd = cmd;
    this.resolve = resolve || console.log;
    this.reject = reject || console.error;
    this.state = 'queued';
  }
}
class Im920 {
  constructor (device) {
    this.uartBuffer = '';
    this.cmdQueue = [];
    this.onReceivedFunc = null;
    let opts = {
      baudRate: 19200
    };
    this.uart = new SerialPort(device, opts, (err) => {
      if (err) {
        return console.log('Error: ', err.message);
      }
    });
    this.reader = this.uart.pipe(new SerialPort.parsers.Readline({delimiter: '\r\n'}));
    this.reader.on('data', this.onData.bind(this));
    this.readNodeNo().then((d) => {
      console.log('RDNN received', d);
    }).catch((e) => {
      console.log('message write failed', e);
    });
  }

  onDataReceived (func) {
    this.onReceivedFunc = func;
  }

  onData (data) {
    let q = this.cmdQueue;
    if (data.match(/^..,....,..:.*$/)) {
      console.log('received data:', data);
      if (this.onReceivedFunc) {
        this.onReceivedFunc(data);
      }
      if (q.length > 0 && q[0].state === 'sent') {
        let rejected = q.shift();
        rejected.reject(`${rejected.cmd} failed: new data received.`);
        this.poll();
      }
    } else {
      if (q.length > 0 && q[0].state === 'sent') {
        if (data === 'NG') {
          let rejected = q.shift();
          rejected.reject(`${rejected.cmd} failed: returns ${data}`);
        } else {
          let resolved = q.shift();
          resolved.resolve(data);
        }
        this.poll();
      } else {
        console.log('received (unknown):', data);
      }
    }
  }

  queue (cmd) {
    return new Promise((resolve, reject) => {
      let q = this.cmdQueue;
      let c = new Command(cmd, resolve, reject);
      c.state = 'queued';
      console.log(`queueing ${c.cmd}`);
      q.push(c);
      this.poll();
    });
  }

  poll () {
    let q = this.cmdQueue;
    if (q.length > 0 && q[0].state === 'queued') {
      q[0].state = 'sent';
      console.log(`sending ${q[0].cmd}`);
      this.uart.write(q[0].cmd + '\r\n');
    }
  }

  enableWriteRegister () {
    return this.queue('ENWR');
  }

  disableWriteRegister () {
    return this.queue('DSWR');
  }

  readDeviceId () {
    return this.queue('RDID');
  }

  setNodeNo (no) {
    return this.queue(`STNN ${no}`);
  }

  readNodeNo () {
    return this.queue('RDNN');
  }

  setReceiverId (id) {
    return this.queue(`SRID ${id}`);
  }

  readReceiverId () {
    return this.queue(`RRID`);
    // TODO Responseは複数行なのでパースする必要あり
  }

  eraseReceiverID () {
    return this.queue(`ERID`);
  }

  setChannel (ch) {
    return this.queue(`STCH ${ch}`);
  }

  readChannel () {
    return this.queue(`RDCH`);
  }

  enableCharacterIo () {
    return this.queue(`ECIO`);
  }

  disableCharacterIo () {
    return this.queue(`DCIO`);
  }

  // TXDT

  txData (data) {
    return this.queue(`TXDA ${data}`);
  }

  readRssi () {
    return this.queue(`RDRS`);
  }

  setPower (power) {
    return this.queue(`STPO ${power}`);
  }

  readPower () {
    return this.queue(`RDPO`);
  }

  setRate (rate) {
    return this.queue(`STRT ${rate}`);
  }

  readRate () {
    return this.queue(`RDRT`);
  }

  readVersion () {
    return this.queue(`RDVR`);
  }

  setSerialBaudRate (baudRate) {
    return this.queue(`SBRT ${baudRate}`);
  }

  disableRx () {
    return this.queue(`DSRX`);
  }

  enableRx () {
    return this.queue(`ENRX`);
  }

  setSleepTimer (time) {
    return this.queue(`SSTM ${time}`);
  }

  readSleepTimer () {
    return this.queue(`RSTM`);
  }

  setWaitTimer (time) {
    return this.queue(`SWTM ${time}`);
  }

  readWaitTimer () {
    return this.queue(`RWTM`);
  }

  enableAnswerBack () {
    return this.queue(`EABK`);
  }

  disableAnswerBack () {
    return this.queue(`DABK`);
  }

  enableRepeater () {
    return this.queue(`ERPT`);
  }

  disableRepeater () {
    return this.queue(`DRPT`);
  }

  readParameters () {
    return this.queue(`RPRM`);
    // TODO : parse multiline response
  }

  softwareReset () {
    return this.queue(`SRST`);
  }

  parameterClear () {
    return this.queue(`PCLR`);
  }
}
module.exports = Im920;
