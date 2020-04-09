// MIT License
//
// Copyright (c) 2012 Universidad Politécnica de Madrid
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Copyright (C) <2018> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

// This file is borrowed from lynckia/licode with some modifications.

/*global require, __dirname, console, process*/
'use strict';

var express = require('express'),
  spdy = require('spdy'),
  bodyParser = require('body-parser'),
  errorhandler = require('errorhandler'),
  morgan = require('morgan'),
  fs = require('fs'),
  https = require('https'),
  icsREST = require('./rest'),
  path = require('path');

var app = express();
var geo = require('./qgeo.js');
geo.init('./');
var accessLogStream = fs.createWriteStream(__dirname + '/../../logs/access.log', {flags: 'a'});
morgan.token('body', function getBody(req) {
  try{
        let str = JSON. stringify(req.body);
        return str;
  } catch(e) {
    return "body parse error";
  }
})

morgan.token('forwarded-addr', function getForwardedAddr(req) {
  let clientIP = getClientIP(req);
  let geoInf = geo.lookup(clientIP);
  //return getClientIP(req);
  return clientIP + '(' + geoInf.isp + ')';
})

// app.configure ya no existe
//app.use(morgan('combined', {stream: accessLogStream}));
app.use(morgan('[:date[clf]] - :remote-addr - :forwarded-addr - ":method :url HTTP/:http-version" :status :res[content-length] - :body',{stream: accessLogStream}));
app.use(errorhandler());
//app.use(morgan('dev'));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));
app.disable('x-powered-by');

app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, PATCH, OPTIONS, DELETE');
  res.header('Access-Control-Allow-Headers', 'origin, content-type');
  res.header('Strict-Transport-Security', 'max-age=1024000; includeSubDomain');
  res.header('X-Content-Type-Options', 'nosniff');
  if (req.method == 'OPTIONS') {
    res.send(200);
  } else {
    next();
  }
});

icsREST.API.init('5e78a6d56315196ce13b8c28', 'ylVH2xv0c+g5y8S/R2dAvARE0z+Rv9Ur+toB+5sp8nVo69w1wY+LCKDN1x5oDAyzoMZkDKJG+oVgUKvE3tAsdn4VG8npysmfH4iIN4MX0iiAcF4PlE6WQ7cnIVhuLRC8bM5uFDL7tRdg3IF7/Z3BDAF/u4Xi6QaiL1ayH5G+uD0=', 'http://localhost:3000/', false);

var sampleRoom;
var pageOption = { page: 1, per_page: 100 };
(function initSampleRoom () {
  icsREST.API.getRooms(pageOption, function(rooms) {
    console.log(rooms.length + ' rooms in this service.');
    for (var i = 0; i < rooms.length; i++) {
      if (sampleRoom === undefined && rooms[i].name === 'sampleRoom') {
        sampleRoom = rooms[i]._id;
        console.log('sampleRoom Id:', sampleRoom);
      }
      if (sampleRoom !== undefined) {
        break;
      }
    }
    var tryCreate = function(room, callback) {
      var options = {};
      icsREST.API.createRoom(room.name, options, function(roomId) {
        console.log('Created room:', roomId._id);
        callback(roomId._id);
      }, function(status, err) {
        console.log('Error in creating room:', err, '[Retry]');
        setTimeout(function() {
          tryCreate(room, options, callback);
        }, 100);
      }, room);
    };

    var room;
    if (!sampleRoom) {
      room = {
        name: 'sampleRoom'
      };
      tryCreate(room, function(Id) {
        sampleRoom = Id;
        console.log('sampleRoom Id:', sampleRoom);
      });
    }
  }, function(stCode, msg) {
    console.log('getRooms failed(', stCode, '):', msg);
  });
})();


////////////////////////////////////////////////////////////////////////////////////////////
// legacy interface begin
// /////////////////////////////////////////////////////////////////////////////////////////
app.get('/getUsers/:room', function(req, res) {
  var room = req.params.room;
  icsREST.API.getParticipants(room, function(users) {
    res.send(users);
  }, function(err) {
    res.send(err);
  });
});

app.post('/createToken/', function(req, res) {
  var room = req.body.room || sampleRoom,
    username = req.body.username,
    role = req.body.role;
    let clientIP = getClientIP(req);
    let geoInf = geo.lookup(clientIP);

    console.log('lengency tokens geoinfo: isp: ',geoInf.isp);
    console.log('lengency tokens geoinfo: ip: ',clientIP);
  //FIXME: The actual *ISP* and *region* info should be retrieved from the *req* object and filled in the following 'preference' data.
  //var preference = {isp: 'isp', region: 'region'};
    var preference = {isp: geoInf.isp, region: 'region'};
  icsREST.API.createToken(room, username, role, preference, function(token) {
    res.send(token);
  }, function(err) {
    res.send(err);
  });
});

app.post('/createRoom/', function(req, res) {
  'use strict';
  var name = req.body.name;
  var options = req.body.options;

  if ((!options) || (options.length == 0)) {
    options = {}
    options.name = name;
    options.views = new Array();
    options.views[0] = {}
    //options.views[0].video = false;
    //options.views[0].label = 'common'; 
    options.views[0].video = {
      format: {
        codec: "h264",
        profile: "B"
      },
      maxInput: 1
    }
  }

  icsREST.API.createRoom(name, options, function(response) {
    res.send(response);
  }, function(err) {
    res.send(err);
  });
});

app.get('/getRoom/:room', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getRoom(room, function(rooms) {
    res.send(rooms);
  }, function(err) {
    res.send(err);
  });
});

app.get('/room/:room/user/:user', function(req, res) {
  'use strict';
  var room = req.params.room;
  var participant_id = req.params.user;
  icsREST.API.getParticipant(room, participant_id, function(user) {
    res.send(user);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/room/:room/user/:user', function(req, res) {
  'use strict';
  var room = req.params.room;
  var participant_id = req.params.user;
  icsREST.API.dropParticipant(room, participant_id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
})

app.delete('/room/:room', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.deleteRoom(room, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
})
////////////////////////////////////////////////////////////////////////////////////////////
// legacy interface begin
// /////////////////////////////////////////////////////////////////////////////////////////


////////////////////////////////////////////////////////////////////////////////////////////
// New RESTful interface begin
// /////////////////////////////////////////////////////////////////////////////////////////
app.post('/rooms', function(req, res) {
  'use strict';
  var name = req.body.name;
  var options = req.body.options;

  if ((!options) || (options.length == 0)) {
    options = {}
    options.name = name;
    options.views = new Array();
    options.views[0] = {}
    //options.views[0].video = false;
    //options.views[0].label = 'common'; 
    options.views[0].video = {
      format: {
        codec: "h264",
        profile: "B"
      },
      maxInput:1
    }
  }

  icsREST.API.createRoom(name, options, function(response) {
    res.send(response);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getRoom(room, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.put('/rooms/:room', function(req, res) {
  'use strict';
  var room = req.params.room,
    config = req.body;
  icsREST.API.updateRoom(room, config, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room', function(req, res) {
  'use strict';
  var room = req.params.room,
    items = req.body;
  icsREST.API.updateRoomPartially(room, items, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.deleteRoom(room, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/participants', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getParticipants(room, function(participants) {
    res.send(participants);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/participants/:id', function(req, res) {
  'use strict';
  var room = req.params.room;
  var participant_id = req.params.id;
  icsREST.API.getParticipant(room, participant_id, function(info) {
    res.send(info);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room/participants/:id', function(req, res) {
  'use strict';
  var room = req.params.room;
  var participant_id = req.params.id;
  var items = req.body;
  icsREST.API.updateParticipant(room, participant_id, items, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/participants/:id', function(req, res) {
  'use strict';
  var room = req.params.room;
  var participant_id = req.params.id;
  icsREST.API.dropParticipant(room, participant_id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/streams', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getStreams(room, function(streams) {
    res.send(streams);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/streams/:stream', function(req, res) {
  'use strict';
  var room = req.params.room,
    stream_id = req.params.stream;
  icsREST.API.getStream(room, stream_id, function(info) {
    res.send(info);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room/streams/:stream', function(req, res) {
  'use strict';
  var room = req.params.room,
    stream_id = req.params.stream,
    items = req.body;
  icsREST.API.updateStream(room, stream_id, items, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/streams/:stream', function(req, res) {
  'use strict';
  var room = req.params.room,
    stream_id = req.params.stream;
  icsREST.API.deleteStream(room, stream_id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.post('/rooms/:room/streaming-ins', function(req, res) {
  'use strict';
  var room = req.params.room,
    url = req.body.url,
    transport = req.body.transport,
    media = req.body.media;

  icsREST.API.startStreamingIn(room, url, transport, media, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/streaming-ins/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    stream_id = req.params.id;
  icsREST.API.stopStreamingIn(room, stream_id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/streaming-outs', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getStreamingOuts(room, function(streamingOuts) {
    res.send(streamingOuts);
  }, function(err) {
    res.send(err);
  });
});

app.post('/rooms/:room/streaming-outs', function(req, res) {
  'use strict';
  var room = req.params.room,
    protocol = req.body.protocol,
    url = req.body.url,
    parameters = req.body.parameters,
    media = req.body.media;

  icsREST.API.startStreamingOut(room, protocol, url, parameters, media, function(info) {
    res.send(info);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room/streaming-outs/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id,
    commands = req.body;
  icsREST.API.updateStreamingOut(room, id, commands, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/streaming-outs/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id;
  icsREST.API.stopStreamingOut(room, id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.get('/rooms/:room/recordings', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getRecordings(room, function(recordings) {
    res.send(recordings);
  }, function(err) {
    res.send(err);
  });
});

app.post('/rooms/:room/recordings', function(req, res) {
  'use strict';
  var room = req.params.room,
    container = req.body.container,
    media = req.body.media;
  icsREST.API.startRecording(room, container, media, function(info) {
    res.send(info);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room/recordings/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id,
    commands = req.body;
  icsREST.API.updateRecording(room, id, commands, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/recordings/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id;
  icsREST.API.stopRecording(room, id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

//Sip call management.
app.get('/rooms/:room/sipcalls', function(req, res) {
  'use strict';
  var room = req.params.room;
  icsREST.API.getSipCalls(room, function(sipCalls) {
    res.send(sipCalls);
  }, function(err) {
    res.send(err);
  });
});

app.post('/rooms/:room/sipcalls', function(req, res) {
  'use strict';
  var room = req.params.room,
    peerUri = req.body.peerURI,
    mediaIn = req.body.mediaIn,
    mediaOut = req.body.mediaOut;
  icsREST.API.makeSipCall(room, peerUri, mediaIn, mediaOut, function(info) {
    res.send(info);
  }, function(err) {
    res.send(err);
  });
});

app.patch('/rooms/:room/sipcalls/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id,
    commands = req.body;
  icsREST.API.updateSipCall(room, id, commands, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.delete('/rooms/:room/sipcalls/:id', function(req, res) {
  'use strict';
  var room = req.params.room,
    id = req.params.id;
  icsREST.API.endSipCall(room, id, function(result) {
    res.send(result);
  }, function(err) {
    res.send(err);
  });
});

app.post('/tokens', function(req, res) {
  'use strict';
  var room = req.body.room || sampleRoom,
    user = req.body.user,
    role = req.body.role;

    let clientIP = getClientIP(req);
    let geoInf = geo.lookup(clientIP);

    console.log('tokens geoinfo: isp: ',geoInf.isp);
    console.log('tokens geoinfo: ip: ',clientIP);

  //Note: The actual *ISP* and *region* information should be retrieved from the *req* object and filled in the following 'preference' data.
  //var preference = {isp: 'yd', region: 'region'};
  var preference = {isp: geoInf.isp, region: 'region'};
  icsREST.API.createToken(room, user, role, preference, function(token) {
    res.send(token);
  }, function(err) {
    res.status(401).send(err);
  });
});
////////////////////////////////////////////////////////////////////////////////////////////
// New RESTful interface end
////////////////////////////////////////////////////////////////////////////////////////////


spdy.createServer({
  spdy: {
    plain: true
  }
}, app).listen(3001, (err) => {
  if (err) {
    console.log('Failed to setup plain server, ', err);
    return process.exit(1);
  }
});

var cipher = require('./cipher');
cipher.unlock(cipher.k, 'cert/.woogeen.keystore', function cb(err, obj) {
  if (!err) {
    spdy.createServer({
      pfx: fs.readFileSync('cert/certificate.pfx'),
      passphrase: obj.sample
    }, app).listen(3004, (error) => {
      if (error) {
        console.log('Failed to setup secured server: ', error);
        return process.exit(1);
      }
    });
  }
  if (err) {
    console.error('Failed to setup secured server:', err);
    return process.exit();
  }
});

function getClientIP(req) {
    var ipaddr = require('ipaddr.js');
    var ipString = (req.headers["X-Forwarded-For"] ||
        req.headers["x-forwarded-for"] ||
        '').split(',')[0] ||
        req.connection.remoteAddress;

    if (ipaddr.isValid(ipString)) {
        try {
            var addr = ipaddr.parse(ipString);
            if (ipaddr.IPv6.isValid(ipString) && addr.isIPv4MappedAddress()) {
                return addr.toIPv4Address().toString();
            }
            return addr.toNormalizedString();
        } catch (e) {
            return ipString;
        }
    }
    return 'unknown';
}

