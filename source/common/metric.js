'use strict'

var log4js = require('log4js');
log4js.configure('./log4js_configuration.json');

var log = log4js.getLogger('Metric');

class TimingMetric {
    constructor(name, key) {
        this.name = name;
        this.key = key;
        this.startTs = new Date();
        this.interval = 0;
        this.metrics = {};
    }

    addMetric(key, val) {
        this.metrics[key] = val;
    }

    finish() {
        let end_time = new Date();
        this.interval = (end_time - this.startTs);
        let inf = JSON.stringify({
            type: 'duration',
            name: this.name,
            start_time: this.startTs,
            end_time: end_time,
            time_cost: this.interval + 'ms',
            details: this.metrics
        });
        log.info(inf);
    }
};

var MetricGather = (function() {

    let groups = new Map();

    function newTimingMetric(group, name, key) {
        let metricKey = name + '-' + key;
        let metric = new TimingMetric(name, key);
        if (!groups.has(group)) {
            groups.set(group, new Map());
        }
        groups.get(group).set(metricKey, metric);
        return metric;
    }

    function getTimingMetric(group, name, key) {
        let metricKey = name + '-' + key;
        if (groups.has(group)) {
            groups.get(group);
            if (groups.get(group).has(metricKey)) {
                return groups.get(group).get(metricKey);
            }
        }
        return null;
    }

    function size() {
        return groups.size;
    }

    function finishTimingMetric(group, name, key) {
        let metricKey = name + '-' + key;
        if (groups.has(group)) {
            if (groups.get(group).has(metricKey)) {
                groups.get(group).get(metricKey).finish();
                groups.get(group).delete(metricKey);
            }
            if (groups.get(group).size == 0) {
                groups.delete(group);
            }
        }
    }

    function finishGroup(group) {
        if (groups.has(group)) {
            groups.get(group).forEach((value, key) => {
                value.finish();
            });
            groups.delete(group);
        }
    }

    function getGroup(group) {
        if (groups.has(group)) {
            return groups.get(group);
        }
        return null;
    }

    function forEachWithGroup(group, callback) {
        if (groups.has(group)) {
            let pos = -1;
            groups.get(group).forEach((value, nameKey) => {
                pos = nameKey.indexOf('-');
                if (pos != -1) {
                    callback(nameKey.slice(0, pos), nameKey.slice(pos + 1), value);
                }
            });
        }
    }

    function doNormalMetric(name, val) {
        let inf = JSON.stringify({ type: 'normal', name: name, start_time: new Date(), details: val });
        log.info(inf);
    }

    return {
        newTimingMetric: newTimingMetric,
        getTimingMetric: getTimingMetric,
        size: size,
        finishTimingMetric: finishTimingMetric,
        finishGroup: finishGroup,
        doNormalMetric: doNormalMetric,
        getGroup: getGroup,
        forEachWithGroup: forEachWithGroup
    };

}());

module.exports = MetricGather;