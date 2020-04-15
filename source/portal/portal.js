// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0
'use strict';

var path = require('path');
var url = require('url');
var crypto = require('crypto');
var log = require('./logger').logger.getLogger('Portal');
var dataAccess = require('./data_access');
var metricGather = require('./metric');

var CONFERENCE_DURATION = 'conference_duration';
var PUBLISH_DURATION = 'publish_duration';
var SUBSCRIBE_DURATION = 'subscribe_duration';

var Portal = function(spec, rpcReq) {
  var that = {},
  token_key = spec.tokenKey,
  cluster_name = spec.clusterName,
  self_rpc_id = spec.selfRpcId;

  /*
     * {participantId: {
     *     in_room: RoomId,
     *     controller: RpcId
     * }}
     */
  var participants = {};

  that.updateTokenKey = function(tokenKey) {
    token_key = tokenKey;
  };

  that.join = function(participantId, token) {
    log.debug('participant[', participantId, '] join with token:', JSON.stringify(token));
    if (participants[participantId]) {
      return Promise.reject('Participant already in room');
    }

    var calculateSignature = function(token) {
      var toSign = token.tokenId + ',' + token.host,
      signed = crypto.createHmac('sha256', token_key).update(toSign).digest('hex');
      return (new Buffer(signed)).toString('base64');
    };

    var validateToken = function(token) {
      var signature = calculateSignature(token);

      if (signature !== token.signature) {
        return Promise.reject('Invalid token signature');
      } else {
        return Promise.resolve(token);
      }
    };

    var tokenCode, userInfo, role, origin, room_id, room_controller;

    return validateToken(token).then(function(validToken) {
      log.debug('token validation ok.');
      return dataAccess.token.delete(validToken.tokenId);
    }).then(function(deleteTokenResult) {
      log.debug('login ok.', deleteTokenResult);
      tokenCode = deleteTokenResult.code;
      userInfo = deleteTokenResult.user;
      role = deleteTokenResult.role;
      origin = deleteTokenResult.origin;
      room_id = deleteTokenResult.room;
      return rpcReq.getController(cluster_name, room_id);
    }).then(function(controller) {
      log.debug('got controller:', controller);
      room_controller = controller;
      return rpcReq.join(controller, room_id, {
        id: participantId,
        user: userInfo,
        role: role,
        portal: self_rpc_id,
        origin: origin
      });
    }).then(function(joinResult) {
      log.debug('join ok, result:', joinResult);
      metricGather.doNormalMetric('join', {
        room_id: room_id,
        participant_id: participantId
      });
      participants[participantId] = {
        in_room: room_id,
        controller: room_controller
      };

      let conference_metric = metricGather.newTimingMetric(participantId, CONFERENCE_DURATION, participantId);
      conference_metric.addMetric('participant_id', participantId);
      conference_metric.addMetric('err_msg', '');
      conference_metric.addMetric('room_id', room_id);

      return {
        tokenCode: tokenCode,
        data: {
          user: userInfo,
          role: role,
          permission: joinResult.permission,
          room: joinResult.room
        }
      };
    });
  };

  that.leave = function(participantId) {
    log.debug('participant leave:', participantId);
    log.debug('metric group size: ', metricGather.size());
    metricGather.finishGroup(participantId);
    if (participants[participantId]) {
      rpcReq.leave(participants[participantId].controller, participantId).
      catch(function(reason) {
        log.info('Failed in leaving, ', reason.message ? reason.message: reason);
      });
      delete participants[participantId];
      return Promise.resolve('ok');
    } else {
      return Promise.reject('Participant has NOT joined');
    }
  };

  that.publish = function(participantId, streamId, pubInfo) {
    log.debug('publish, participantId:', participantId, 'streamId:', streamId, 'pubInfo:', pubInfo);
    let publishMetric = metricGather.newTimingMetric(participantId, 'publish_duration', streamId);
    publishMetric.addMetric('participant_id', participantId);
    publishMetric.addMetric('stream_id', streamId);
    if (participants[participantId] === undefined) {
      publishMetric.addMetric('err_msg', 'participant has not joined');
      metricGather.finishTimingMetric(participantId, 'publish_duration', streamId);
      return Promise.reject('Participant has NOT joined');
    }

    publishMetric.addMetric('err_msg', '');
    publishMetric.addMetric('room_id', participants[participantId].in_room);
    metricGather.doNormalMetric('publish', {
      room_id: participants[participantId].in_room,
      participant_id: participantId,
      stream_id: streamId
    });
    return rpcReq.publish(participants[participantId].controller, participantId, streamId, pubInfo);
  };

  that.unpublish = function(participantId, streamId) {
    log.debug('unpublish, participantId:', participantId, 'streamId:', streamId);
    metricGather.finishTimingMetric(participantId, 'publish_duration', streamId);
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.unpublish(participants[participantId].controller, participantId, streamId);
  };

  that.streamControl = function(participantId, streamId, commandInfo) {
    log.debug('streamControl, participantId:', participantId, 'streamId:', streamId, 'command:', commandInfo);
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.streamControl(participants[participantId].controller, participantId, streamId, commandInfo);
  };

  that.subscribe = function(participantId, subscriptionId, subDesc) {
    log.debug('subscribe, participantId:', participantId, 'subscriptionId:', subscriptionId, 'subDesc:', subDesc);
    let subscribeMetric = metricGather.newTimingMetric(participantId, 'subscribe_duration', subscriptionId);
    subscribeMetric.addMetric('participant_id', participantId);
    subscribeMetric.addMetric('subscription_id', subscriptionId);
    if (subDesc.media.audio && subDesc.media.audio.from) {
      subscribeMetric.addMetric('audio_stream_id', subDesc.media.audio.from);
    } else {
      subscribeMetric.addMetric('audio_stream_id', '');
    }
    if (subDesc.media.video && subDesc.media.video.from) {
      subscribeMetric.addMetric('video_stream_id', subDesc.media.video.from);
    } else {
      subscribeMetric.addMetric('video_stream_id', '');
    }
    if (participants[participantId] === undefined) {
      subscribeMetric.addMetric('err_msg', 'participant has not joined');
      metricGather.finishTimingMetric(participantId, 'subscribe_duration', subscriptionId);
      return Promise.reject('Participant has NOT joined');
    }

    subscribeMetric.addMetric('err_msg', '');
    subscribeMetric.addMetric('room_id', participants[participantId].in_room);
    metricGather.doNormalMetric('subscribe', {
      room_id: participants[participantId].in_room,
      participant_id: participantId,
      subscription_id: subscriptionId
    });
    return rpcReq.subscribe(participants[participantId].controller, participantId, subscriptionId, subDesc);
  };

  that.unsubscribe = function(participantId, subscriptionId) {
    log.debug('unsubscribe, participantId:', participantId, 'subscriptionId:', subscriptionId);
    metricGather.finishTimingMetric(participantId, 'subscribe_duration', subscriptionId);
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.unsubscribe(participants[participantId].controller, participantId, subscriptionId);
  };

  that.subscriptionControl = function(participantId, subscriptionId, commandInfo) {
    log.debug('subscriptionControl, participantId:', participantId, 'subscriptionId:', subscriptionId, 'command:', commandInfo);
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.subscriptionControl(participants[participantId].controller, participantId, subscriptionId, commandInfo);
  };

  that.onSessionSignaling = function(participantId, sessionId, signaling) {
    log.debug('onSessionSignaling, participantId:', participantId, 'sessionId:', sessionId, 'signaling:', signaling);

    var participant = participants[participantId];
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.onSessionSignaling(participants[participantId].controller, sessionId, signaling);
  };

  that.text = function(participantId, to, msg) {
    log.debug('text, participantId:', participantId, 'to:', to, 'msg:', msg);
    if (participants[participantId] === undefined) {
      return Promise.reject('Participant has NOT joined');
    }

    return rpcReq.text(participants[participantId].controller, participantId, to, msg);
  };

  that.getParticipantsByController = function(type, id) {
    var result = [];
    for (var participant_id in participants) {
      if ((type === 'node' && participants[participant_id].controller === id) || (type === 'worker' && participants[participant_id].controller.startsWith(id))) {
        result.push(participant_id);
      }
    }
    return Promise.resolve(result);
  };

  setInterval(() =>{
    let roomMetric = {};
    let roomCount = 0;
    let totalMetric = {rooms_count:0, publish_count:0, subscribe_count:0};
    for (let p in participants) {
      let room = participants[p].in_room;
      if(room === undefined) {
        continue;
      }
      if (roomMetric[room] === undefined) {
        roomMetric[room] = {};
        roomCount += 1;
        totalMetric.rooms_count += 1;
      }
      metricGather.forEachWithGroup(p, (name, key, value) =>{
        if (roomMetric[room][name] === undefined) {
          roomMetric[room][name] = 1;
        } else {
          roomMetric[room][name] += 1;
        }

        if(name == PUBLISH_DURATION) {
          totalMetric.publish_count += 1;
        } else if(name == SUBSCRIBE_DURATION) {
          totalMetric.subscribe_count += 1;
        }
      });
    }

    for(let r in roomMetric) {
        metricGather.doNormalMetric('rooms_stat', {room: r, count: roomMetric[r]});
    }

    metricGather.doNormalMetric('total_rooms_stat', totalMetric);
  },
  30 * 1000);

  return that;
};

module.exports = Portal;
