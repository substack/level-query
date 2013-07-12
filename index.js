var qs = require('querystring');
var url = require('url');
var search = require('level-search');
var Transform = require('readable-stream/transform');
var resumer = require('resumer');
var through = require('through');
var JSONStream = require('JSONStream');

var nextTick = typeof setImmediate !== 'undefined'
    ? setImmediate : process.nextTick
;

module.exports = function (db) {
    var index = search(db, 'index');
    
    return function (params) {
        if (typeof params === 'string') {
            params = qs.parse(url.parse(params).query);
        }
        
        var format = params.format;
        if (format === undefined) format = 'json';
        
        var stringify = createStringify(format);
        if (!stringify) return errorStream(400, 
            'Unknown format: ' + JSON.stringify(format) + '.\n'
            + 'Support formats: json, ndj.'
        );
        
        var mode = params.mode;
        if (mode === undefined) mode = 'dead';
        if (mode !== 'dead' && mode !== 'live' && mode !== 'follow') {
            return errorStream(400, 
                'Unknown mode: ' + JSON.stringify(mode) + '.\n'
                + 'Supported modes: dead, live, follow.'
            );
        }
        
        var stream;
        if (params.filter) {
            try { var q = JSON.parse(params.filter) }
            catch (err) {
                return errorStream(400, err);
            }
            if (!Array.isArray(q)) {
                return errorStream(400,
                    'filter parameter must be a JSON array'
                );
            }
            stream = index.createSearchStream(q);
        }
        else {
            var end = params.end;
            if (end > '~' || end === undefined) end = '~';
            
            var dbOpts = defined({
                start: params.start,
                end: end,
                reverse: parseBoolean(params.reverse),
                keys: parseBoolean(params.keys),
                values: parseBoolean(params.values),
                limit: params.limit && parseInt(params.limit, 10),
                keyEncoding: params.keyEncoding,
                valueEncoding: params.valueEncoding,
                encoding: params.encoding
            });
            if (dbOpts.keys === false && dbOpts.values === false) {
                return errorStream(400,
                    '"keys" and "values" parameters can\'t both be false'
                );
            }
            stream = db.createReadStream(dbOpts);
        }
        return setType(stream.pipe(stringify), 'application/' + format);
    };
};

function errorStream (code, msg) {
    var tr = through();
    nextTick(function () {
        tr.emit('code', code);
        tr.emit('type', 'text/plain');
        tr.emit('head', code, { 'content-type': 'text/plain' });
        tr.queue('Error: ' + (msg && msg.message || msg) + '\n');
        tr.queue(null);
    });
    return tr;
}

function setType (stream, type) {
    return stream;
    nextTick(function () {
        stream.emit('code', 200);
        stream.emit('type', type);
        stream.emit('head', 200, { 'content-type': type });
    });
    return stream;
}

function parseBoolean (s) {
    if (s === undefined) return undefined;
    if (!s) return false;
    if (s === 'false') return false;
    if (s === '0') return false;
    return true;
}

function defined (obj) {
    return Object.keys(obj).reduce(function (acc, key) {
        if (obj[key] !== undefined) acc[key] = obj[key];
        return acc;
    }, {});
}

function createStringify (format) {
    if (format === 'json') {
        var tr = new Transform({ objectMode: true });
        var first = true;
        tr._transform = function (row, enc, next) {
            if (first) {
                first = false;
                this.push(JSON.stringify(row));
            }
            else {
                this.push(',\n' + JSON.stringify(row));
            }
            next();
        };
        tr._flush = function (next) {
            this.push(']\n');
            this.push(null);
            next();
        };
        tr.push('[');
        return tr;
    }
    else if (format === 'ndj') {
        // ...
    }
}