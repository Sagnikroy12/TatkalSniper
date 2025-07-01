const fs = require('fs');
const zlib = require('zlib');

const path = require('path');

const inp = fs.createReadStream(path.join(__dirname, 'eng.traineddata'));
const out = fs.createWriteStream(path.join(__dirname, 'eng.traineddata.gz'));

inp.pipe(zlib.createGzip()).pipe(out);
