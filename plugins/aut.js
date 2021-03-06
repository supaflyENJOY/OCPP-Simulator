/**
 *  Hello world plugins
 *
 */


var cbxs = {

  name: 'CBXS',
  description: 'CBXS automatic mode description',
  author: '',

  ocpp_version: '1.6',
  system: 'cp',

  onLoad: function() {
    var self = cbxs.self = this;

    if(self.system != 'cp') {
      self.log(cbxs.logPrefix + 'Error: this plugin needs a Charge Point '+
        'Simulator to run.');
      self.unload();
      return;
    }

    // BootNotification at start
    self.cp.call('BootNotification');


    for(var i=1; i <= 2; i++) {
      self.cp.call('StatusNotification', {
        connectorId: i,
        status: 'Available',
        errorCode: 'NoError',
        info: '',
      });
    }

    self.onConnectionEvent(function(type, cbId) {
      switch(type) {
      case 'connected':
        self.log(cbxs.logPrefix + 'Connected to Central System.');
        cbxs.processTransactionsQueue();
        break;
      case 'disconnected':
        self.log(cbxs.logPrefix + 'Disconnected to Central System.');
        break;
      }
    });

    /**
     *  Custom commands
     */
    self.onCommand(function(command) {
      var commandObj = self.parse(command);

      if(commandObj.command == 'cache') {
        self.log(cbxs.logPrefix + 'Whitelist content: '+
          JSON.stringify(cbxs.whiteList));
        return true;
      }

      if(commandObj.command == 'connectors') {
        for(var index in cbxs.connectors) {
          var connector = cbxs.connectors[index];
          console.log(" - Connector #"+ connector.connectorId +" - status"+
            ": "+ (connector.isCharging ? "charging" : "not charging"));
        }
      }

      if(commandObj.command == 'connector_liaison') {
        if(commandObj.arguments[0] == undefined) {
          console.log(cbxs.logPrefix +'Usage: connector_liaison <id> '+
            'for simulating a connection interruption.');
          return true;
        }

        var connectorId = parseInt(commandObj.arguments[0]);

        for(var connector in cbxs.connectors) {
          if(connector.connectorId == connectorId) {
            connector.isLiaisonWorking = !connector.isLiaisonWorking;
          }
        }
	console.log('Cool');

        return true;
      }

      if(commandObj.command == 'identification') {
        if(commandObj.arguments.length == 0) {
          console.log(cbxs.logPrefix +'Usage: identification <id>');
          return true;
        }

        var id = commandObj.arguments[0];

        // check if connector related to id
        for(var index in cbxs.connectors) {
          var connector = cbxs.connectors[index];
          if(connector.idTagRelated == id) {
            cbxs.actionsQueue.push({
              procedure: 'StopTransaction',
              arguments: {idTag: id}
              });
            return true;
          }
        }

        var found = false;
        for(var key in cbxs.whiteList) {
          if(key == id)
            found = true;
        }

        if(found) {
          var connector = cbxs.getAvailableConnector();
          connector.idTagRelated = id;
          cbxs.startTransactionIfPossible(connector.connectorId);
        }
        else {
          cbxs.idTagTmp = id;
          self.cp.call('Authorize', {idTag: id});
        }

        return true;
      }
    });

    /**
     *  what to do when receiving a call result:
     */
    self.onResult('BootNotification', function(values) {
      cbxs.heartbeatInterval = values.heartbeatInterval;
      cbxs.sendHB(self, true);
    });

    self.onResult('Authorize', function(values) {
      if(values.idTagInfo.status == "Accepted") {
        var connector = cbxs.getAvailableConnector();
        connector.isCharging = true;
        connector.transactionIdClient = cbxs.transactionIdClient++;
        connector.idTagRelated = cbxs.idTagTmp;
        cbxs.idTagTmp = null;
        cbxs.startTransactionIfPossible(connector.connectorId);
      }
    });

    self.onResult('StartTransaction', function(values) {
      var transactionId = values.transactionId;

      for(var index in cbxs.connectors) {
        var connector = cbxs.connectors[index];
        if(connector.isCharging && connector.transactionIdServer == null) {
          connector.transactionIdServer = transactionId;
        }
      }
    });

    /**
     *  when a remote call is received:
     */

    self.onCall('ClearCache', function(values) {
      // clear the white list
      cbxs.whiteList = [];
      self.log(cbxs.logPrefix + ' White list cleared.');
    });

    self.onCall('ChangeAvailability', function(values) {
      for(var index in cbxs.connectors) {
        var connector = cbxs.connectors[index];
        if(connector.connectorId == values.connectorId) {
          connector.isBlocked = !!(values.type == "Operative");
        }
      }
    });

    self.onCall('RemoteStartTransaction', function(values) {
      var connector = cbxs.getConnectorFromConnectorId(values.connectorId);

      if(!connector.isCharging && !connector.isBlocked
        && connector.isLiaisonWorking) {
        connector.isCharging = true;
        connector.meterCurrent = 0;
        connector.idTagRelated = values.idTag;
        cbxs.startTransactionIfPossible(values.connectorId);
      }
      else {
        return { status: "Rejected" };
      }
    });

    self.onCall('RemoteStopTransaction', function(values) {
      var found = false;

      for(var index in cbxs.connectors) {
        var connector = cbxs.connectors[index];
        console.log(connector.transactionIdServer, values.transactionId)
        if(connector.transactionIdServer == values.transactionId) {
          connector.isCharging = false;
          connector.meterCurrent = 0;
          connector.transactionIdClient = null;
          connector.transactionIdServer = null;

          found = true;
        }
      }

      if (found) {
        cbxs.actionsQueue.push({
          procedure: 'StopTransaction',
          arguments: {
            transactionId: values.transactionId
          }
        });
      }
      else {
        return { status: "Rejected" };
      }
    });

    self.onCall('GetDiagnostics', function(values) {
      self.cp.call('DiagnosticsStatusNotification', {"status": "Uploaded"});
    });

    self.onCall('UpdateFirmware', function(values) {
      self.cp.call('FirmwareStatusNotification', {"status": "Downloaded"});
      self.cp.call('FirmwareStatusNotification', {"status": "Installed"});
    });

    self.onIdle(function() {
      cbxs.processActionsQueue();

      clearTimeout(cbxs.hbTimeout);
      cbxs.sendHB(self, true);
    });
  },

  /**
   *  Customs fields
   */

  self: null,

  logPrefix: '[CBXS] ',

  whiteList: [],
  actionsQueue: [],
  transactionsQueue: [],

  hbTimeout: null,
  heartbeatInterval: null,

  idTagTmp: null,

  transactionIdClient: 0,

  connectors: [
    {
      connectorId: 1,
      isCharging: false,
      isBlocked: false,
      isLiaisonWorking: true,
      idTagRelated: "",
      meterCurrent: 0,

      transactionIdClient: null, // generated by client
      transactionIdServer: null, // response from server
    },{
      connectorId: 2,
      isCharging: false,
      isBlocked: false,
      isLiaisonWorking: true,
      idTagRelated: "",
      meterCurrent: 0,

      transactionIdClient: null, // generated by client
      transactionIdServer: null, // response from server
    }
  ],

  processActionsQueue: function() {
    var msg = null;
    while(msg = cbxs.actionsQueue.pop()) {
      switch(msg.procedure) {
      case 'StartTransaction':
        var connector
            = cbxs.getConnectorFromConnectorId(msg.arguments.connectorId);
          if(!connector.isBlocked && connector.isLiaisonWorking) {
            cbxs.transactionsQueue.push(msg);
            cbxs.processTransactionsQueue();
          }
        break;
      default:
        cbxs.transactionsQueue.push(msg);
        cbxs.processTransactionsQueue();
      }
    }
  },

  processTransactionsQueue: function() {
    var msg = null;
    while(msg = cbxs.transactionsQueue.pop()) {
      cbxs.self.cp.call(msg.procedure, msg.arguments);
    }
  },

  sendHB: function(self, dropFirst) {
    if(!cbxs.heartbeatInterval)
      return;

    if(!dropFirst)
      self.cp.call('Heartbeat');

    cbxs.hbTimeout = setTimeout(cbxs.sendHB, cbxs.heartbeatInterval * 1000,
      self);
  },

  startTransactionIfPossible: function(connectorId) {
    var connector = null;
    for(var index in cbxs.connectors) {
      var c = cbxs.connectors[index];
      if(c.connectorId == connectorId)
        connector = c;
    }

    if(connector == null)
      return;

    if(!connector.isBlocked && connector.isLiaisonWorking) {
      cbxs.actionsQueue.push({
        procedure: 'StartTransaction',
        arguments: {
          connectorId: connectorId,
          idTag: connector.idTagRelated,
          timestamp: new Date().toISOString(),
          meterStart: 0,
        }
      });
    }
    else {
      cbxs.self.log(cbxs.logPrefix + "Can't start transaction on connector #"+
        connectorId);
    }
  },

  getAvailableConnector: function() {
    for(var index in cbxs.connectors) {
      var connector = cbxs.connectors[index];
      if(!connector.isCharging)
        return connector;
    }

    return null;
  },

  getConnectorFromConnectorId: function(connectorId) {
    for(var index in cbxs.connectors) {
      var c = cbxs.connectors[index];
      if(c.connectorId == connectorId)
        return c;
    }

    return null;
  }

};



function formatDate(date) {

  var day = String(date.getDate());
  if (day.length <2){
    day = ('0' + day.slice(-2));
  }


  var monthIndex = String(date.getMonth());
  if (monthIndex.length <2){
    monthIndex = ('0' + monthIndex.slice(-2));
  }
  var year = date.getFullYear();
  var h = date.getHours();
  if (h<3){
    h = 24-h;
  }
  h = String(h-3);
  if (h.length <2){
    h = ('0' + h.slice(-2));
  }
  var m = String(date.getMinutes());

  var s = String(date.getSeconds());
  if (m.length <2){
    m = ('0' + m.slice(-2));
  }
  if (s.length <2){
    s = ('0' + s.slice(-2));
  }
  return year + '-' + monthIndex + '-' + day+"T"+h+":"+m+":"+s+"Z";
};

setInterval(() => {
  for(var index in cbxs.connectors) {
    var c = cbxs.connectors[index];
    if(c.isCharging) {
      const meter = Math.ceil(Math.random() * 20 + 5);
      c.meterCurrent += meter;
      cbxs.actionsQueue.push({
        procedure: 'MeterValues',
        arguments: {
          connectorId: c.connectorId,
          transactionId: c.transactionIdServer,
          meterValue: /*JSON.stringify*/([{
            "timestamp": formatDate(new Date()),
            "sampledValue": [
              {
                "value": "" + c.meterCurrent,
                "unit": "Wh",
                "measurand": "Energy.Active.Import.Register"
              },
            ]
          }])
        }
      });
      cbxs.processActionsQueue();

    }
  }
}, 5000);

module.exports = cbxs;

