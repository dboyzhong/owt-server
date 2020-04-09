
'use strict';

const fs = require('fs')
const readline = require('readline');
const path = require('path');
const http = require('http');
const stream = require('stream');
const crypto = require('crypto');


var GEOIP= (function(){

    var geoUrl;
    var cacheFile;
    var initted;
    var ipRanges = new Array();

    var ispMap = new Map();
    ispMap.set('联通', 'lt');
    ispMap.set('电信', 'dx');
    ispMap.set('移动', 'yd');
    ispMap.set('教育网', 'jy');
    ispMap.set('未知',   'unknown');

    function init(cachedir, url) {
        if(!initted) {
            initted = true;
            cacheFile = path.join(cachedir, 'ip_standard.txt');
            geoUrl = url;
            loadFromFile(cacheFile, function(err) {
                if(err) {
                    console.log('geoip: load from file failed: ', err.toString());
                    loadFromNet(function(err){
                        if(err) {
                            console.log('geoip: load from net failed: ', err.toString());
                        }
                        startRefreshRoutine();
                    });
                } else {
                    startRefreshRoutine();
                }
            });
        }
    }

    function lookup(addr) {
        let addr_num = IPToNumber(addr);
        let res = bSearch(ipRanges, addr_num);
        let isp = 'unknown';
        if(-1 == res) {
            return {country: "unknown", province: "unknown", isp: "unknown"};
        }
        if (ispMap.has(ipRanges[res].isp)) {
            isp = ispMap.get(ipRanges[res].isp);
        }
        return {country:  ipRanges[res].country,
                province: ipRanges[res].province,
                isp:      isp 
               }
    }

    function loadFromFile(file, callback) {
        let ips = new Array();
        let ss = fs.createReadStream(file);
        ss.on('error', (err)=>{
            callback(err);
            ss.close();
            r1.close();
        });
        ss.on('end', ()=>{
            callback(null);
            ipRanges = ips;
            ss.close();
            r1.close();
        });
        const r1 = readline.createInterface({
            input: ss
        });

        r1.on('line', (line) => {
            parseLine(line, ips);
        });
    }

    function loadFromNet(callback) {

        let tmp = cacheFile + '.tmp';
        let ips = new Array();
        let ss = fs.createWriteStream(tmp);
        ss.on('error', (err)=>{
        });
        ss.on('close', ()=>{
            fs.rename(tmp, cacheFile, (err)=>{
                if(err) {
                    console.log("geoip: rename failed: ", err.toString());
                }
            });
        });

        let bs = new stream.PassThrough();
        const r1 = readline.createInterface({
            input: bs 
        });

        var clear = ()=>{
            bs.end();
            r1.close();
            ss.close();
        }

        r1.on('line', (line)=>{
            parseLine(line, ips);
        });

        let request = http.get('http://api.ip.360.cn/file/ip_standard.txt', (res)=>{
            const { statusCode } = res;
            if(statusCode !== 200) {
                console.error("geoip: resp error status_code: ", statusCode)
                clear();
                let err = new Error('resp status_code is not 200');
                callback(err);
                request.abort(); 
                return;
            }
            res.on('data', (data)=>{
                bs.write(data);
            });
            res.on('error', (err)=>{
                console.log('geoip: read from url error');
                clear();
                callback(null);
            });
            res.on('end', ()=>{
                console.log('geoip: read from url finished');
                ipRanges = ips;
                clear();
                callback(null);
            });

            res.pipe(ss);

        }).on('error', (err)=>{
            console.log('geoip: http request error: ', err.toString());
            clear();
            callback(err);
        });
    }

    function parseLine(line, ips) {
        let inf = line.split(/\s*\t/);
        if(inf.length != 8) {
            console.warn('geo record with wrong length: ', inf.length);
            return;
        }
        ips.push({
            start:    parseInt(inf[0]),
            end:      parseInt(inf[1]),
            country:  inf[2],
            province: inf[3],
            isp :     inf[7]
        });
    }

    function startRefreshRoutine() {
        console.log('geoip: start refresh routine');
        setInterval(()=>{
            refresh();
        }, 600 * 1000);
    }

    function refresh() {
        let request = http.get('http://api.ip.360.cn/deploy/source_file/standard.md5.txt', (res)=>{

            const { statusCode } = res;
            if(statusCode !== 200) {
                console.log('geoip: get url with status_code: ', statusCode);
                res.resume();
                return;
            }

            let rawData = '';
            res.on('data', (chunk) => { rawData += chunk; });
            res.on('end', ()=>{
                let stream = fs.createReadStream(cacheFile);
                let fsHash = crypto.createHash('md5');

                stream.on('data', (d)=> {
                    fsHash.update(d);
                });

                stream.on('end', ()=> {
                    let md5 = fsHash.digest('hex');
                    if(md5 != rawData) {

                        console.log('geoip: start update: file md5: %s url, md5: %s', md5, rawData);
                        loadFromNet((err)=>{
                            if(err) {
                                console.log('geoip: load from net failed: ', err.toString());
                            } else {
                                console.log('geoip: load from net success');
                            }
                        });
                    }
                });
                
                stream.on('error', ()=>{
                    loadFromNet((err)=>{
                        if(err) {
                            console.log('geoip: load from net failed: ', err.toString());
                        } else {
                            console.log('geoip: load from net success');
                        }
                    });
                });
            });

        }).on('error', (err)=>{
        });
    }

    function bSearch(arr, key) {
        let low = 0;
        let high = arr.length - 1;

        while(low <= high) {
            let mid = parseInt((low + high) / 2);
            if(arr[mid].start <= key && key <= arr[mid].end) {
                return mid;
            } else if(key < arr[mid].start) {
                high = mid - 1;
            } else if(key > arr[mid].end) {
                low = mid + 1;
            }
        }
        return -1;
    }

    function IPToNumber(addr) {
        let arr = addr.split('.');
        return 16777216 * parseInt(arr[0]) +
               65536    * parseInt(arr[1]) +
               256      * parseInt(arr[2]) +
               parseInt(arr[3]);
    }

    return {
        init: init,
        lookup: lookup
    };

}());

module.exports = GEOIP;